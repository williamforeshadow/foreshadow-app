import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  getConversationContext,
  type ConversationContext,
} from './conversationContext';
import {
  getConciergeTrainingForProperty,
  formatTrainingForPrompt,
} from './conciergeTraining';
import type { GuestMessageRecord } from '@/lib/messages';

// Task-triage generator — the operator-facing sibling of draftReply.ts. Where
// the Concierge drafts a guest REPLY, this reads the same conversation and
// decides whether the guest's message implies operational WORK that should
// become a task, and if so drafts that task for human review.
//
// Two deliberate differences from draftReply:
//   - Single structured call (no tool loop). The output is a JSON decision, not
//     guest prose, so determinism and a hard gate matter more than tool use.
//   - It carries OPS context (the property's department list) the guest-facing
//     Concierge intentionally lacks, so it can tag a real department_id.
//
// Temperature stays 0: we want a conservative, repeatable gate, not creativity.

const TRIAGE_MAX_TOKENS = 600;
const MAX_THREAD_MESSAGES = 30;

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
type Priority = (typeof PRIORITIES)[number];

const SYSTEM_PROMPT = `You triage a short-term-rental guest conversation for the host's operations team. Your ONLY job: decide whether the latest guest message implies operational work the host's team must do, and if so, draft a single task for a human to review.

Be conservative. The overwhelming majority of guest messages need NO task. Draft a task ONLY when the message clearly implies physical or operational work for the host's team — for example: a broken or malfunctioning appliance/fixture, a maintenance or repair need, a cleaning problem, a missing/used-up supply that must be restocked, a safety issue, or an explicit request that requires staff action (e.g. "can someone bring extra towels").

Do NOT draft a task for: questions and information requests (check-in time, wifi, directions, recommendations), booking/availability/pricing logistics, small talk, thanks, complaints with no actionable remedy, or anything the team would simply answer rather than act on. When in doubt, do NOT draft a task.

If you draft a task:
- title: a short imperative summary of the work (e.g. "Fix AC — not cooling in unit"). Required.
- description: 1-3 sentences of useful context drawn ONLY from the conversation (what the guest reported, any specifics). Never invent details.
- priority: one of urgent | high | medium | low. Reserve "urgent" for safety issues or anything making the unit unusable during an active stay.
- department_id: choose from the provided department list if one clearly fits; otherwise omit it. Use ONLY an id from that list — never invent one.

"Concierge training" (when present) is the team's guidance for when and how to create tasks at this property — follow it.

Output: respond with ONLY a single JSON object, no prose, no code fences. Shape:
{"should_draft": boolean, "task": {"title": string, "description": string, "priority": "urgent"|"high"|"medium"|"low", "department_id": string|null} | null, "reasoning": string}
When should_draft is false, set "task" to null. Keep "reasoning" to one short sentence.`;

export interface ProposedTaskDraft {
  title: string;
  description: string | null;
  priority: Priority;
  department_id: string | null;
}

export interface TriageResult {
  should_draft: boolean;
  task: ProposedTaskDraft | null;
  reasoning: string;
}

interface DepartmentRow {
  id: string;
  name: string | null;
}

async function loadDepartments(): Promise<DepartmentRow[]> {
  const { data, error } = await getSupabaseServer()
    .from('departments')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) {
    console.warn('[task triage] department lookup failed', { error });
    return [];
  }
  return (data ?? []) as DepartmentRow[];
}

/** Pull the first JSON object out of a model response, tolerating code fences. */
function parseTriageJson(raw: string): TriageResult | null {
  const text = raw.trim();
  // Strip a leading ```json / ``` fence if present.
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const shouldDraft = o.should_draft === true;
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';

  if (!shouldDraft) return { should_draft: false, task: null, reasoning };

  const t = o.task;
  if (!t || typeof t !== 'object') return { should_draft: false, task: null, reasoning };
  const tt = t as Record<string, unknown>;
  const title = typeof tt.title === 'string' ? tt.title.trim() : '';
  if (!title) return { should_draft: false, task: null, reasoning };
  const priority: Priority = PRIORITIES.includes(tt.priority as Priority)
    ? (tt.priority as Priority)
    : 'medium';
  const description =
    typeof tt.description === 'string' && tt.description.trim()
      ? tt.description.trim()
      : null;
  const departmentId =
    typeof tt.department_id === 'string' && tt.department_id.trim()
      ? tt.department_id.trim()
      : null;

  return {
    should_draft: true,
    task: { title, description, priority, department_id: departmentId },
    reasoning,
  };
}

/**
 * Decide whether a conversation's latest activity warrants a task, and draft it.
 * Throws on an API error; returns a "no task" result for benign conversations.
 */
export async function generateProposedTaskDraftFromContext(
  ctx: ConversationContext,
  opts: { today?: string } = {},
): Promise<TriageResult> {
  let trainingBlock = '';
  try {
    const rules = await getConciergeTrainingForProperty(
      ctx.conversation.property_id,
      'task',
    );
    trainingBlock = formatTrainingForPrompt(rules);
  } catch {
    trainingBlock = '';
  }

  const departments = await loadDepartments();

  const nowMs = Date.now();
  const sent = ctx.messages.filter((m) => !isFuture(m, nowMs));
  const recent = sent.slice(-MAX_THREAD_MESSAGES);
  if (recent.length === 0) {
    return { should_draft: false, task: null, reasoning: 'No messages to triage.' };
  }

  const guestName =
    ctx.reservation?.guest_name ?? ctx.conversation.guest_name ?? 'the guest';
  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const facts: string[] = [`Today's date: ${today}`, `Guest name: ${guestName}`];
  if (propertyName) facts.push(`Property: ${propertyName}`);
  if (ctx.stay.check_in) facts.push(`Check-in: ${ctx.stay.check_in}`);
  if (ctx.stay.check_out) facts.push(`Check-out: ${ctx.stay.check_out}`);

  const departmentBlock = departments.length
    ? departments
        .map((d) => `- ${d.name ?? 'Unnamed'} (id: ${d.id})`)
        .join('\n')
    : '(no departments configured — omit department_id)';

  const transcript = recent
    .map(
      (m) =>
        `${m.direction === 'outbound' ? 'Host' : 'Guest'}: ${(m.body ?? '').trim() || '(no text)'}`,
    )
    .join('\n');

  const userParts = [
    'Conversation facts:',
    facts.map((f) => `- ${f}`).join('\n'),
    '',
    'Departments you may assign (use the exact id, or omit):',
    departmentBlock,
  ];
  if (trainingBlock) {
    userParts.push(
      '',
      'Concierge training — when and how to create tasks at this property:',
      trainingBlock,
    );
  }
  userParts.push(
    '',
    'Conversation so far (oldest to newest):',
    transcript,
    '',
    'Decide whether the latest guest activity implies operational work for the host team, and respond with the JSON object only.',
  );

  const client = getAnthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: TRIAGE_MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userParts.join('\n') }],
  });

  const raw = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const parsed = parseTriageJson(raw);
  if (!parsed) {
    // A malformed response is treated as "no task" — never fabricate a task from
    // an unparseable triage output.
    console.warn('[task triage] unparseable model output', { raw: raw.slice(0, 200) });
    return { should_draft: false, task: null, reasoning: 'Unparseable triage output.' };
  }

  // Guard against a hallucinated department_id not in the real list.
  if (parsed.task?.department_id) {
    const valid = departments.some((d) => d.id === parsed.task!.department_id);
    if (!valid) parsed.task.department_id = null;
  }

  return parsed;
}

/** Convenience: build context from an id, then triage. */
export async function generateProposedTaskDraft(
  conversationId: string,
): Promise<TriageResult> {
  const ctx = await getConversationContext(conversationId);
  if (!ctx) throw new Error('Conversation not found');
  return generateProposedTaskDraftFromContext(ctx);
}

function isFuture(m: GuestMessageRecord, nowMs: number): boolean {
  const ts = m.sent_at;
  return !!ts && new Date(ts).getTime() > nowMs;
}
