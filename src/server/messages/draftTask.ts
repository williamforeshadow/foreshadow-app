import type {
  MessageParam,
  TextBlock,
  TextBlockParam,
  ToolUseBlock,
  ToolResultBlockParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { dispatchTool, type ToolCallTrace } from '@/src/agent/dispatchTool';
import { getConciergeProcedure } from '@/src/agent/tools/getConciergeProcedure';
import type { ToolContext, ToolDefinition } from '@/src/agent/tools/types';
import {
  getConversationContext,
  type ConversationContext,
} from './conversationContext';
import {
  getConciergeTrainingForProperty,
  formatTrainingForPrompt,
  formatTrainingIndexForPrompt,
} from './conciergeTraining';
import { resolveOpsToday } from './opsToday';
import type { GuestMessageRecord } from '@/lib/messages';

// Task-triage generator — the operator-facing sibling of draftReply.ts. Where
// the Concierge drafts a guest REPLY, this reads the same conversation and
// decides whether the guest's message implies operational WORK that should
// become a task, and if so drafts that task for human review.
//
// Two deliberate differences from draftReply:
//   - The output is a JSON decision, not guest prose, so determinism and a hard
//     sensitivity gate matter more than free-form tool use. The model may make
//     one detour — loading a situational task rule via get_concierge_procedure —
//     before emitting that JSON; otherwise it answers in a single pass.
//   - It carries OPS context (the property's department list) the guest-facing
//     Concierge intentionally lacks, so it can tag a real department_id.
//
// Temperature stays 0: we want a conservative, repeatable gate, not creativity.

const TRIAGE_MAX_TOKENS = 900; // per-turn headroom so the final JSON isn't truncated
const MAX_THREAD_MESSAGES = 30;
const MAX_TRIAGE_ITERATIONS = 4; // one grounding tool detour + the JSON turn, with slack

// The triage loop's single tool: load a situational task rule's full text on
// demand. Mirrors the reply path — 'always' task rules are pinned into the
// (cached) system prefix; 'situational' ones are indexed by title and pulled in
// only when the conversation matches. It's core infra, so (unlike the reply
// toolset) it isn't gated by the per-tool operator master switches.
const TRIAGE_TOOLS: ReadonlyArray<ToolDefinition<unknown, unknown>> = [
  getConciergeProcedure as unknown as ToolDefinition<unknown, unknown>,
];
const TRIAGE_TOOLS_BY_NAME = new Map(TRIAGE_TOOLS.map((t) => [t.name, t]));

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
- suggested_assignee_ids: the team member(s) best suited to this task, but ONLY when the team's Task rules make it reasonably clear who should handle it (who-does-what guidance, availability outlines, etc.). Use ONLY ids from the provided "Team members" list. Usually one person; include more only when the work clearly needs several. Return an empty array [] when no rule points to a specific person, when you are unsure, or when it's work for an outside vendor — a human will assign those. Never invent an id or a name, and never guess from names alone.
- scheduled_date / scheduled_time: an optional suggested schedule. scheduled_date is "YYYY-MM-DD"; scheduled_time is "HH:MM" on a 24-hour clock. Today's date is given in the facts below — use it to resolve any relative reference (e.g. "tomorrow", "this Friday") to an absolute date. Leave EITHER as null unless a specific date/time is grounded in the conversation or called for by the team's Task rules; you may set a date without a time. Never fabricate a schedule that nothing in the conversation or the rules supports.

Output: respond with ONLY a single JSON object, no prose, no code fences. Shape:
{"tasks": [{"title": string, "description": string, "priority": "urgent"|"high"|"medium"|"low", "department_id": string|null, "suggested_assignee_ids": string[], "scheduled_date": string|null, "scheduled_time": string|null}], "reasoning": string}
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
  /**
   * Suggested team-member assignee ids (validated against the roster). Empty
   * when the rules don't make an assignee clear or the work is vendor-shaped —
   * a human assigns those. Applied as the default on accept.
   */
  suggested_assignee_ids: string[];
  /** Suggested schedule, in canonical task formats. Null unless the conversation
   *  or the team's Task rules call for a specific date/time. */
  scheduled_date: string | null; // 'YYYY-MM-DD'
  scheduled_time: string | null; // 'HH:MM' (24h)
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

interface TeamMemberRow {
  id: string;
  name: string | null;
  /** Department name(s) the member belongs to — soft context for the model, not a filter. */
  departments: string[];
}

/**
 * Non-vendor users the triage may suggest as assignees, each with their
 * department name(s) (via the user_departments join). Vendors are excluded — the
 * AI never assigns a vendor; vendor work is offered manually. Departments ride
 * along as CONTEXT only; candidates are never filtered by department.
 */
async function loadTeamMembers(): Promise<TeamMemberRow[]> {
  const supabase = getSupabaseServer();
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, role')
    .order('name', { ascending: true });
  if (error) {
    console.warn('[task triage] team member lookup failed', { error });
    return [];
  }
  // Exclude vendors only. Filter in JS (not .neq) so null/unset roles — which the
  // app treats as staff — stay in the roster instead of being dropped by SQL's
  // `NULL <> 'vendor'` (which is not true).
  const rows = ((users ?? []) as Array<{ id: string; name: string | null; role: string | null }>)
    .filter((u) => u.role !== 'vendor')
    .map((u) => ({ id: u.id, name: u.name }));
  if (rows.length === 0) return [];

  const { data: links, error: linkErr } = await supabase
    .from('user_departments')
    .select('user_id, departments(name)')
    .in(
      'user_id',
      rows.map((u) => u.id),
    );
  if (linkErr) {
    // Departments are enhancement only — fall back to the roster without them.
    console.warn('[task triage] team department lookup failed', { error: linkErr });
    return rows.map((u) => ({ id: u.id, name: u.name, departments: [] }));
  }

  const byUser = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{
    user_id: string;
    departments: { name: string | null } | null;
  }>) {
    const name = l.departments?.name;
    if (!name) continue;
    byUser.set(l.user_id, [...(byUser.get(l.user_id) ?? []), name]);
  }

  return rows.map((u) => ({ id: u.id, name: u.name, departments: byUser.get(u.id) ?? [] }));
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
    const suggestedAssigneeIds = Array.isArray(tt.suggested_assignee_ids)
      ? (tt.suggested_assignee_ids as unknown[]).filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        )
      : [];
    // Accept only the canonical formats createTask validates (YYYY-MM-DD / HH:MM);
    // anything malformed is dropped to null rather than stored as garbage.
    const scheduledDate =
      typeof tt.scheduled_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tt.scheduled_date.trim())
        ? tt.scheduled_date.trim()
        : null;
    const scheduledTime =
      typeof tt.scheduled_time === 'string' && /^\d{2}:\d{2}$/.test(tt.scheduled_time.trim())
        ? tt.scheduled_time.trim()
        : null;
    tasks.push({
      title,
      description,
      priority,
      department_id: departmentId,
      suggested_assignee_ids: suggestedAssigneeIds,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
    });
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
  // Task training, split by tier (mirrors draftReply):
  //  - 'always' rules are pinned into the (cached) system prefix — they govern
  //    every triage (what always counts as work for this team).
  //  - 'situational' rules are listed by title only; the model loads the full
  //    body on demand via get_concierge_procedure when the conversation matches.
  let alwaysTrainingBlock = '';
  let situationalIndexBlock = '';
  try {
    const rules = await getConciergeTrainingForProperty(
      ctx.conversation.property_id,
      'task',
    );
    alwaysTrainingBlock = formatTrainingForPrompt(rules.filter((r) => r.tier !== 'situational'));
    situationalIndexBlock = formatTrainingIndexForPrompt(
      rules.filter((r) => r.tier === 'situational'),
    );
  } catch {
    // Training is enhancement, not a hard dependency — never block triage on it.
    alwaysTrainingBlock = '';
    situationalIndexBlock = '';
  }

  const [departments, sensitivity, existingTitles, teamMembers] = await Promise.all([
    loadDepartments(),
    loadTaskProposalSensitivity(),
    loadExistingProposalTitles(ctx.conversation.id),
    loadTeamMembers(),
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
  // Resolve "today" in the property's (or org default) timezone, not UTC — a
  // late-evening US "tomorrow" must not roll a day forward against UTC.
  const today = opts.today ?? (await resolveOpsToday(ctx.conversation.property_id));

  const facts: string[] = [`Today's date: ${today}`, `Guest name: ${guestName}`];
  if (propertyName) facts.push(`Property: ${propertyName}`);
  if (ctx.stay.check_in) facts.push(`Check-in: ${ctx.stay.check_in}`);
  if (ctx.stay.check_out) facts.push(`Check-out: ${ctx.stay.check_out}`);

  const departmentBlock = departments.length
    ? departments
        .map((d) => `- ${d.name ?? 'Unnamed'} (id: ${d.id})`)
        .join('\n')
    : '(no departments configured — omit department_id)';

  const teamBlock = teamMembers
    .map((m) => {
      const depts = m.departments.length ? ` — ${m.departments.join(', ')}` : '';
      return `- ${m.name ?? 'Unnamed'} (id: ${m.id})${depts}`;
    })
    .join('\n');

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
  if (teamMembers.length) {
    userParts.push(
      '',
      'Team members you may suggest as assignees (use the exact id, or leave suggested_assignee_ids empty).',
      'The department after each name is context, NOT a restriction — suggest whoever the rules point to:',
      teamBlock,
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

  // Stable, per-property system prefix — cached so the loop's passes (and repeat
  // triages for the same property within the cache TTL) reuse it. Order: base
  // rules → always-on training → the situational index + how to load it. Unlike
  // the reply path there's no per-call gate clause, so the whole block is cacheable.
  const cachedSystemText = [
    SYSTEM_PROMPT,
    alwaysTrainingBlock
      ? `Task rules that ALWAYS apply — follow them on every triage:\n${alwaysTrainingBlock}`
      : '',
    situationalIndexBlock
      ? `Situational task rules available on demand — listed by title only, NOT shown in full. When the latest guest message matches one of these topics, call get_concierge_procedure with the matching id(s) to load the full rule BEFORE deciding tasks, then apply it. After loading what you need, output the final JSON object exactly as instructed. The always-applies rules above are always in effect and never need loading.\n${situationalIndexBlock}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemBlocks: TextBlockParam[] = [
    { type: 'text', text: cachedSystemText, cache_control: { type: 'ephemeral' } },
  ];

  // Offer the on-demand loader (always — even with an empty index it's a harmless
  // no-op and keeps the cached prefix contiguous). It's core infra, so it isn't
  // subject to the per-tool operator master switches.
  const tools: Tool[] = TRIAGE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema,
  }));
  if (tools.length > 0) {
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: 'ephemeral' },
    };
  }

  // Bind the property + category so get_concierge_procedure loads THIS property's
  // situational TASK rules (not reply rules, not another property's).
  const toolCtx: ToolContext = {
    draft: {
      propertyId: ctx.conversation.property_id,
      channel: ctx.conversation.channel ?? null,
      category: 'task',
    },
  };

  const client = getAnthropic();
  const conversation: MessageParam[] = [{ role: 'user', content: userParts.join('\n') }];
  const trace: ToolCallTrace[] = [];

  // The triage loop. The model may load a situational task rule before deciding;
  // when it stops calling tools, its text is the JSON decision. With no tool call
  // this is identical to the old single-shot path.
  let raw = '';
  let gotFinal = false;
  for (let i = 0; i < MAX_TRIAGE_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: TRIAGE_MAX_TOKENS,
      temperature: 0,
      system: systemBlocks,
      tools,
      messages: conversation,
    });

    // Prompt-cache observability: a creation on the first pass, reads on later
    // passes / repeat triages for the same property within the cache TTL.
    const u = response.usage;
    console.log(
      `[task triage] pass ${i} cache: created=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} input=${u.input_tokens}`,
    );

    conversation.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      // Only the final, non-tool turn carries the JSON decision; interim tool
      // turns are never parsed.
      raw = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      gotFinal = true;
      break;
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUses.map((use) => {
        const tool = TRIAGE_TOOLS_BY_NAME.get(use.name);
        if (!tool) {
          return Promise.resolve<ToolResultBlockParam>({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: JSON.stringify({
              ok: false,
              error: { code: 'unknown_tool', message: `Tool "${use.name}" is not available here.` },
            }),
          });
        }
        return dispatchTool(tool, use, trace, toolCtx);
      }),
    );
    conversation.push({ role: 'user', content: toolResults });
  }

  if (!gotFinal) {
    // The model kept calling tools past the cap without emitting JSON — treat as
    // "no tasks" (best-effort), matching the unparseable handling below. Never throw.
    console.warn('[task triage] loop exhausted without a JSON turn');
    return { tasks: [], reasoning: 'Triage did not converge.' };
  }

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

  // Guard against hallucinated assignee ids: keep only ids that exist in the
  // roster we offered the model (drops invented ids or names it echoed back).
  const teamMemberIds = new Set(teamMembers.map((m) => m.id));
  for (const task of parsed.tasks) {
    task.suggested_assignee_ids = task.suggested_assignee_ids.filter((id) =>
      teamMemberIds.has(id),
    );
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
