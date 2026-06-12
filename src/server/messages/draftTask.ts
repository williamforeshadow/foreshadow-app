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

// Domain-agnostic scaffold. What actually QUALIFIES as a task is NOT hardcoded
// here — it comes from two per-organization inputs injected into the user
// message: the Sensitivity calibration (a 1-5 dial) and the team's Task rules.
// So this prompt makes no assumptions about the business (short-term rental,
// hotel, long-term property management, etc.) or what kind of work a task is.
const SYSTEM_PROMPT = `You triage a conversation between a guest (or resident/customer) and a property or hospitality operations team. Your job: identify EVERY distinct operational task the latest guest message warrants, and draft each one for a human to review.

An "operational task" is any actionable item the team should do or follow up on — it may be maintenance, administrative, or service work. It is NOT an answer to a question; things the team can simply reply to are not tasks on their own.

How to decide WHAT qualifies:
- Apply the "Sensitivity" calibration provided below — it sets the threshold for how much warrants a task at this organization. Do not impose your own assumptions about what counts; follow the calibrated level.
- Also follow the team's "Task rules" when provided — they add organization- and property-specific guidance and concrete examples.
- Create a SEPARATE task for EACH distinct issue or request that meets the threshold. If one message reports several unrelated problems (e.g. a broken appliance AND a cleanliness issue), that is multiple tasks, not one. Only combine things that are genuinely the same piece of work.
- When nothing in the latest message meets the threshold, or you are unsure, return an empty list.
- Do NOT include any task that is already covered by the "Already raised" list (when provided) — those are handled. But DO include new, distinct issues even when other issues in the same conversation were already raised.

For each task:
- title: a short imperative summary of that one issue. Required.
- description: 1-3 sentences of context drawn ONLY from the conversation (what the guest said, any specifics). Never invent details, names, times, or numbers.
- priority: one of urgent | high | medium | low. Reserve "urgent" for safety issues or anything making the space unusable during an active stay.
- department_id: choose from the provided department list if one clearly fits; otherwise omit it. Use ONLY an id from that list — never invent one.

Output: respond with ONLY a single JSON object, no prose, no code fences. Shape:
{"tasks": [{"title": string, "description": string, "priority": "urgent"|"high"|"medium"|"low", "department_id": string|null}], "reasoning": string}
"tasks" is an array of zero or more tasks (empty when nothing qualifies). Keep "reasoning" to one short sentence.`;

// The sensitivity ladder. Cumulative: each level includes everything below it.
// Generic by design — concrete, domain-specific examples belong in Task rules.
const SENSITIVITY_LADDER = [
  'Critical only — draft a task ONLY for urgent or safety-critical issues, or anything making the space unusable. Ignore everything else.',
  'Clear operational work — draft a task when the message clearly calls for hands-on work or an explicit action: repairs, maintenance, a problem with the space, restocking/supplies, or a direct request for staff to do something. Not for questions, information requests, logistics, small talk, or thanks.',
  'Operational + administrative — everything above, plus administrative or service actions the team must handle: booking or stay changes, special arrangements, accommodations, and follow-ups that require an action (not just an answer).',
  'Proactive — everything above, plus most actionable requests and any notable feedback, problem, or preference that likely needs follow-up, even when the guest did not explicitly ask for action.',
  'Track everything — draft a task for essentially any guest feedback, request, issue, or preference the team might want to track or follow up on. Skip only pure pleasantries (greetings, thanks) with nothing to act on.',
] as const;

function buildSensitivityBlock(level: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(level)));
  const lines = SENSITIVITY_LADDER.map((text, i) => `- Level ${i + 1} — ${text}`);
  return [
    `Sensitivity is set to ${clamped} of 5. The levels are cumulative:`,
    ...lines,
    '',
    `Apply level ${clamped}: draft a task only when the latest guest message meets the level ${clamped} threshold.`,
  ].join('\n');
}

export interface ProposedTaskDraft {
  title: string;
  description: string | null;
  priority: Priority;
  department_id: string | null;
}

export interface TriageResult {
  /** Zero or more distinct tasks to propose; empty when nothing qualifies. */
  tasks: ProposedTaskDraft[];
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

/** Org-level task-proposal sensitivity (1-5). Falls back to 2 when unset. */
async function loadTaskProposalSensitivity(): Promise<number> {
  try {
    const { data } = await getSupabaseServer()
      .from('operations_settings')
      .select('task_proposal_sensitivity')
      .eq('id', 1)
      .maybeSingle();
    const v = (data as { task_proposal_sensitivity?: number } | null)?.task_proposal_sensitivity;
    if (typeof v === 'number' && v >= 1 && v <= 5) return v;
  } catch {
    // Column/table may be missing in older environments — fall back.
  }
  return 2;
}

/**
 * Titles of tasks already raised for this conversation (pending or accepted), so
 * the model can avoid re-proposing the same issue on a follow-up message. This
 * is the semantic dedup that replaces the old one-proposal-per-conversation gate.
 */
async function loadExistingProposalTitles(conversationId: string): Promise<string[]> {
  const { data, error } = await getSupabaseServer()
    .from('proposed_tasks')
    .select('title, status')
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'accepted']);
  if (error) {
    console.warn('[task triage] existing-proposal lookup failed', { conversationId, error });
    return [];
  }
  return ((data ?? []) as Array<{ title: string | null }>)
    .map((r) => (r.title ?? '').trim())
    .filter(Boolean);
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
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';

  const rawTasks = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks: ProposedTaskDraft[] = [];
  for (const t of rawTasks) {
    if (!t || typeof t !== 'object') continue;
    const tt = t as Record<string, unknown>;
    const title = typeof tt.title === 'string' ? tt.title.trim() : '';
    if (!title) continue; // a task with no title is meaningless — drop it
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
    tasks.push({ title, description, priority, department_id: departmentId });
  }

  return { tasks, reasoning };
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

  const [departments, sensitivity, existingTitles] = await Promise.all([
    loadDepartments(),
    loadTaskProposalSensitivity(),
    loadExistingProposalTitles(ctx.conversation.id),
  ]);

  const nowMs = Date.now();
  const sent = ctx.messages.filter((m) => !isFuture(m, nowMs));
  const recent = sent.slice(-MAX_THREAD_MESSAGES);
  if (recent.length === 0) {
    return { tasks: [], reasoning: 'No messages to triage.' };
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
    'Sensitivity calibration:',
    buildSensitivityBlock(sensitivity),
    '',
    'Departments you may assign (use the exact id, or omit):',
    departmentBlock,
  ];
  if (trainingBlock) {
    userParts.push(
      '',
      'Task rules — when and how to create tasks for this team/property:',
      trainingBlock,
    );
  }
  if (existingTitles.length) {
    userParts.push(
      '',
      'Already raised for this conversation — do NOT propose anything that duplicates these:',
      existingTitles.map((t) => `- ${t}`).join('\n'),
    );
  }
  userParts.push(
    '',
    'Conversation so far (oldest to newest):',
    transcript,
    '',
    'Identify every distinct task the latest guest message warrants under the sensitivity calibration above (one per distinct issue, excluding anything already raised), and respond with the JSON object only.',
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
    // A malformed response is treated as "no tasks" — never fabricate a task
    // from an unparseable triage output.
    console.warn('[task triage] unparseable model output', { raw: raw.slice(0, 200) });
    return { tasks: [], reasoning: 'Unparseable triage output.' };
  }

  // Guard against a hallucinated department_id not in the real list.
  for (const task of parsed.tasks) {
    if (task.department_id && !departments.some((d) => d.id === task.department_id)) {
      task.department_id = null;
    }
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
