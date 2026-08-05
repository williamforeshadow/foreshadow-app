import type {
  MessageParam,
  Tool,
  ToolUseBlock,
  ToolResultBlockParam,
  TextBlock,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { toAnthropicTools } from './tools';
import type { ToolContext } from './tools/types';
import { dispatchToolUse, type ToolCallTrace } from './dispatch';
import { SKILLS_BLOCK } from './skills';
import { getAnthropic, MODEL } from './anthropic';
import { todayInTz } from '@/src/lib/dates';

// Names of tools that mutate state. Used by the hallucination backstops
// (write-claim mask in src/agent/backstops.ts) to validate that any
// "I created..."-style claim is paired with a successful write call.
//
// Add new write tools here as they land. preview_task is included because
// it's the front half of the write protocol; the action-claim regex is
// keyed on what the model SAYS, not which tool fired, so any successful
// preview/commit pair is grounding for a confirmation message.
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'preview_task',
  'create_task',
  'preview_bin',
  'create_bin',
  'preview_tasks_batch',
  'create_tasks_batch',
  'preview_task_update',
  'update_task',
  'preview_tasks_update_batch',
  'update_tasks_batch',
  'preview_task_delete',
  'delete_task',
  'preview_comment',
  'add_comment',
  'preview_comments_batch',
  'add_comments_batch',
  'preview_property_contact_upsert',
  'commit_property_contact_upsert',
  'preview_property_contact_batch',
  'commit_property_contact_batch',
  'preview_property_contact_delete',
  'commit_property_contact_delete',
  'preview_property_knowledge_write',
  'commit_property_knowledge_write',
  'preview_property_knowledge_batch',
  'commit_property_knowledge_batch',
  'preview_slack_file_attachment',
  'commit_slack_file_attachment',
]);

// runAgent — single entry point that drives Anthropic's tool-use loop.
//
// Replaces the old "ask Claude for SQL, then run it" approach with a clean
// agent loop: the model can call any tool registered in src/agent/tools, we
// dispatch + return structured results, then ask the model again until it
// stops calling tools.

// getAnthropic() and MODEL now live in ./anthropic so the draft generator can
// share them without importing this module (which would be circular).

// Bumped from 1024 so multi-tool turns (e.g. listing 25 tasks after a
// find_tasks call) never get truncated mid-enumeration. Truncation pushes the
// model toward summarizing/inferring instead of citing what it received.
const MAX_TOKENS = 2048;
// NOTE: this model rejects non-default sampling parameters, so the temperature 0
// we relied on for tool-grounded answers is gone and cannot be restored. Grounding
// now rests entirely on the prompt's identifier/linking rules and on the write-claim
// backstop. Thinking is pinned off to match the previous model's behavior (this
// model runs adaptive thinking when the parameter is omitted, which would also eat
// into MAX_TOKENS); turn it on deliberately, with a raised budget, if tool
// selection needs the help.
// Hard ceiling on iterations. A well-behaved tool catalog should never need
// more than 3-4 round-trips for a single user question; this is a safety net.
const MAX_ITERATIONS = 10;

// Prompt caching (see also src/server/messages/draftReply.ts, which does the
// same for the Concierge). This loop re-sends a large fixed prefix on EVERY
// iteration: the 38 tool schemas serialize to ~16.5k tokens and the system
// prompt is another ~6.5k. A four-iteration turn was paying full input price
// for ~23k tokens four times over. Caching that prefix makes iterations 2..N
// read it at a fraction of the cost and trims time-to-first-token.
//
// Breakpoints, in the canonical request order (tools → system → messages):
//   1. the last tool     — closes the tool block
//   2. the system prompt — closes tools + system as one contiguous prefix
//   3. the last message  — rolling; see withRollingCacheBreakpoint
// Three of the four allowed breakpoints, so there's headroom.
const CACHE_CONTROL = { type: 'ephemeral' } as const;

/**
 * Serialize the registry and mark the final tool as a cache breakpoint.
 *
 * The registry is static per process, so this is hoisted out of the loop and
 * the resulting array is reused across every iteration of a run.
 */
function buildCachedTools(): Tool[] {
  const tools = toAnthropicTools() as Tool[];
  if (tools.length > 0) {
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: CACHE_CONTROL,
    };
  }
  return tools;
}

/**
 * Return `messages` with a cache breakpoint on the last content block of the
 * final message, WITHOUT mutating the input.
 *
 * The breakpoint rolls forward one message per iteration. Each request reads
 * the entry the previous iteration wrote (its prompt is an exact prefix of
 * this one) and writes a new entry covering the delta — so accumulated tool
 * results are paid for at full price exactly once, no matter how many more
 * iterations the loop runs. This matters most on tool-heavy turns: three
 * get_property_knowledge dossiers are far larger than the prompt itself.
 *
 * Not mutating `conversation` is deliberate — it keeps stale breakpoints from
 * piling up past the four-per-request limit as the loop advances, and leaves
 * the caller's `history` objects untouched.
 */
function withRollingCacheBreakpoint(messages: MessageParam[]): MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;

  // History arrives as plain strings; promote to a one-block array so the
  // breakpoint has somewhere to attach. Semantically identical to the string.
  const blocks: unknown[] =
    typeof last.content === 'string'
      ? [{ type: 'text', text: last.content }]
      : [...last.content];
  if (blocks.length === 0) return messages;

  blocks[blocks.length - 1] = {
    ...(blocks[blocks.length - 1] as object),
    cache_control: CACHE_CONTROL,
  };
  return [
    ...messages.slice(0, -1),
    { ...last, content: blocks } as MessageParam,
  ];
}

/** Exported so the prompt can be rendered and inspected without a live run. */
export function buildSystemPrompt(
  clientTz: string | undefined,
  surface: AgentSurface,
  actor: AgentActor | undefined,
): string {
  const { date, tz } = todayInTz(clientTz);
  // Surface-specific opener gives the model a clue about formatting
  // expectations. Slack mrkdwn doesn't render markdown headings or
  // **bold** the same way the in-app chat (full markdown) does. The
  // route layer still post-processes for safety, but priming the model
  // here cuts down on rendering surprises.
  const surfaceLine =
    surface === 'slack'
      ? '- You are answering inside Slack. Keep replies short, plain text. Use bold sparingly with single-asterisk syntax (*bold*). Do not use markdown headings (#, ##) — Slack does not render them.'
      : '- You are answering inside the Foreshadow web app chat panel. Replies render as full markdown. When ANY write previews this turn register pending actions, the chat panel shows a SINGLE Confirm/Cancel pair directly below your message — one click commits (or cancels) every preview from this turn atomically. Present the plan once and tell the user to use those buttons; do NOT tell them to "confirm each one" or to type "yes".';

  // Identity grounding. Both surfaces resolve the caller before the run —
  // Slack matches slack user → email → users row; web takes the verified
  // Supabase session via requireAuthContext — so this block feeds a real
  // user_id into the prompt and "me" / "my" / "I" / "mine" resolve without
  // the model having to call find_users by name (which would be both slower
  // and ambiguous when names collide). The permissive fallback is kept for
  // type-safety only; no surface ships without an actor today.
  const actorBlock = actor
    ? `- The user you are talking to is ${actor.name} (user_id: ${actor.appUserId}). When they say "me", "my", "I", or otherwise refer to themselves, use this user_id directly — do NOT call find_users to look themselves up. Their role is "${actor.role}".`
    : `- The current user's identity is not resolved. If they refer to themselves ("me", "my"), ask which user they mean before calling tools that filter by user.`;

  return `You are an AI assistant for Foreshadow, a vacation rental property management platform.

Current context:
- Today is ${date} (${tz}). The user is typing from this timezone.
- Stored dates and times in Foreshadow are wall-clock in the property's local timezone. Each property may have an explicit timezone; when unset, it inherits the org default. When the user uses relative language ("today", "this week", "yesterday", "overdue"), interpret it against the date above and pass concrete YYYY-MM-DD dates to tools.
- For any tool that supports a reference_date input, pass ${date} so date-relative filters (e.g. overdue) align with the user's local sense of "today".
${actorBlock}
${surfaceLine}

How to be useful:
- The user knows their own business. A field they did not mention is a decision, not an oversight — leave it empty and move on. Unscheduled, unassigned, and unbinned are ordinary, valid states for a task, not gaps for you to fill.
- If you can write a title, you have enough to preview. Never ask for an optional field. Preview with what you have — the Confirm/Cancel pair is where the user corrects you, and fixing a preview costs them one click while answering your question costs them a whole round trip.
- Offering to do the work is not doing the work. Never end a turn with "do you want me to...", "shall I...", or "let me know and I'll set up the preview". If you know what to build, build it and show them.
- Never ask for something you could look up. If a resolver tool can answer your question, call it. Ask only after the resolver has run and come back genuinely ambiguous, and then ask using its results.
- Never narrate a tool call instead of making it. If you write "let me check", "I want to search first", or "I'll look that up", the call happens in the same turn, before you reply.
- Being unable to do something yourself is a reason to write a task, not a reason to refuse. You cannot place orders, browse the web, or contact people — but "someone should do X" is exactly what a task is for. Say what you cannot do in one sentence, then preview the task that captures it.

Linking tasks:
- Whenever you mention a specific task in your reply, render it as a markdown link using the task_url field returned by find_tasks or create_task: \`[task title or short label](task_url)\`.
- This applies to single tasks, lists of tasks, and confirmations after a successful create_task — every task you name gets a link.
- Use the task title as the visible label when the task has one; otherwise use the template_name. Keep the label short.
- The link target MUST be the verbatim task_url from the tool result for that exact task — never construct one yourself, never reuse a URL across tasks. If a row has no task_url, omit the link rather than inventing one.
- Both Slack and the in-app chat render markdown links correctly, so the same syntax works on every surface. Do not use any other link syntax.

List formatting:
- When enumerating multiple items (tasks, properties, reservations, users, etc.), use a markdown bullet list with the asterisk character ("* "). Never use the dash character ("- ") for bullets, and never use numbered lists ("1. ", "2. ", ...) unless the user explicitly asks for ranked or ordered output. Slack mrkdwn renders "* " as a real bullet glyph but renders "- " literally as a dash; using "* " is the only marker that looks right on every surface.
${
  surface === 'slack'
    ? `- Slack-specific (STRICT): when a task line is just enumeration (e.g. "here are the tasks assigned to Rae"), the ENTIRE line is the bullet + a single markdown link whose label is just the task title. That means: "* [Task title](task_url)" and NOTHING ELSE on that line. No em-dash. No pipe. No property name. No address. No date. No time. No status. No priority. No assignee. No emoji. No parenthetical. The Block Kit card we attach below the message already shows property + status + due, so any inline metadata duplicates it and adds visual noise.
- For single-task answers, a brief one-sentence wrapper (e.g. "Found it — [Task title](url).") is fine; the rule applies specifically to enumerated bullet lines.`
    : `- In-app chat (STRICT): when a task line is just enumeration, the ENTIRE line is the bullet + a single markdown link whose label is just the task title. That means: "* [Task title](task_url)" and NOTHING ELSE on that line. No em-dash. No pipe. No property name. No address. No date. No time. No status. No priority. No assignee. No emoji. No parenthetical. The task card we render below the message already shows property + status + due, so any inline metadata duplicates it and adds visual noise.
- For single-task answers, a brief one-sentence wrapper (e.g. "Found it — [Task title](url).") is fine; the rule applies specifically to enumerated bullet lines.`
}

You answer questions about the user's properties, reservations, and tasks by calling the read-only tools provided. You never write SQL. When a question requires data, call the appropriate tool, then answer using the structured data the tool returns.

Finding tasks vs. reading one:
- find_tasks FINDS tasks. It filters and lists, and it deliberately carries only a thin projection: it returns comment_count and attachment_count as NUMBERS, and it does not return the description or the checklist at all.
- get_task READS one task. Given a single task_id it returns the full description, every checklist field with its recorded answer plus completed/total progress, the comment bodies with their authors, and attachment metadata.
- So: never answer a question about a task's CONTENT from find_tasks. If the user asks what the comments say, what the note or description is, how far along the checklist is, what's left to do, or what someone wrote — call find_tasks to resolve the task, then call get_task on the task_id(s) it returned. Reporting "this task has 4 comments" when the user asked what the comments SAY is a wrong answer; read them.
- \`search\` is fuzzy and ranked. It tolerates typos and partial words, so pass the user's OWN wording rather than correcting or formalizing it — "dishwaser" finds "dishwasher", "yard" finds "backyard". Results arrive best-match-first (meta.search_ranked), weighted toward recently-active tasks, so the first result is your best candidate rather than merely the earliest-scheduled one.
- Every searched row carries \`matched_in\`. When it says "comment" or "description", the text that matched is NOT anywhere in that row — do not guess what it said from the task title. Open the task with get_task and read it.
- If \`search\` returns nothing, that is a real answer: no task's title, description, property, category, or comments resemble that wording. Say so plainly. Do not retry the same idea with three synonyms hoping one lands, and do not fall back to listing unrelated tasks.
- get_task accepts up to FIVE task_ids at once and returns an array. When find_tasks leaves several plausible candidates, open them all in one call rather than one at a time. Do not call it on a whole list — more than five candidates means narrow further with find_tasks first.

Availability vs. bookings (three distinct things):
- Guest bookings and OWNER STAYS both live in reservations: use find_reservations. An owner stay is dates the owner reserved for themselves (kind='owner_stay', no guest revenue) — still a reservation, still found there.
- Maintenance/manual BLOCKS (a property marked unavailable with no one staying — e.g. a maintenance hold) are NOT reservations and live separately: use find_calendar_blocks.
- So a property can be unavailable for two different reasons. For a complete "is this property free / why is it unavailable" picture, consider BOTH find_reservations (any kind) and find_calendar_blocks. Never assume "no reservations" means "available" — a block can still make it unavailable.
- For "which days is X free / available?", "can they book these dates?", or "what's open in July?", call check_availability — do NOT eyeball find_reservations and work out the open gaps yourself. Deriving availability by hand mis-handles the turnover day (a guest's checkout day is bookable by the next arrival), the minimum-night rule, and the night count. check_availability runs the deterministic engine and returns correct, ready-to-quote windows; use find_reservations only to see WHO is in a given booking.

Capability/help questions:
- If the user asks what you can do, whether you have the capability to do something, or whether you can edit/delete/upload/read a category of records, answer directly from this tool catalog and the write protocol below. Do not call a read tool unless they ask about a specific live property, task, reservation, person, or file.
- For Property Knowledge capability questions, be explicit: you can create/update/delete rooms, room attributes, documents, and vendor contacts where tools exist; you can clear/update Access and Connectivity fields. You cannot write Property Information (a separate page holding the property's fixed facts — name, address, bedrooms, bathrooms, active state, PMS linkage) or the Activity ledger; if the user wants those changed, point them at the property's Information page.
- Avoid self-doubt language in user-facing replies. If something needs a live lookup, do the lookup — don't ask the user to supply what a resolver would have told you.

Guest messaging:
- You can READ guest conversations for operator-facing requests (summarizing, reviewing): find_conversations (resolve a conversation by what was SAID in it using \`search\`, or by guest name / property / recent activity) and read_conversation_thread (the full message history plus the linked reservation).
- You do NOT write to guests yourself. When the operator wants something said to a guest, call the concierge tool with the conversation_id and their intent in plain English. It returns a draft for the operator to review — nothing is sent. Do not pass property facts; it retrieves what it is allowed to share.

Grounding rules (critical):
- If a tool call returns zero rows or a not_found error, say so plainly. Never substitute remembered or invented data for missing tool output.

Tool results come back in a uniform envelope:
- On success: { ok: true, data: ..., meta: { returned, limit, truncated } }
- On failure: { ok: false, error: { code, message, hint? } }

Identifier rules (critical):
- Only pass id values (property_id, template_id, department_id, reservation_id, bin_id, user_id, etc.) that you obtained from a tool result earlier in this same turn.
- Never fabricate ids, never guess them, and never reuse ids from prior conversation turns — those ids are not visible to you and cannot be trusted.
- All ids in this system are random UUIDs (e.g. "a856ddd4-a9ac-4a9f-8a63-a8be59e90d74"). They are NOT derivable from names, slugs, or any text the user typed. If you catch yourself constructing a UUID-looking string from scratch, that is fabrication — stop and call the appropriate resolver instead.
- If you don't have an id, call the appropriate resolver tool first: find_properties for a property, find_templates for a template, find_departments for a department, find_bins for an EXISTING sub-bin (find_bins resolves names → bin_ids; it does NOT create new bins — use preview_bin / create_bin or preview_tasks_batch's new_sub_bin shorthand for that), find_users for a person, find_reservations for a stay/guest. Resolvers exist for every id-bearing field — there is no excuse for guessing. Note: the default "Task Bin" has no UUID to resolve; to land a task there, omit bin_id and pass is_binned=true on preview_task (or shared_bin: { is_binned: true } on preview_tasks_batch).
- If a tool returns error.code = "not_found" for an id you passed, do NOT retry with a different guess. Call the resolver tool instead and use the id it returns.

Option-listing rule:
- If you ask the user to choose between options ("which template?", "which Billy?"), every option you list MUST come from a tool result returned during this same turn. Never list options from memory, training data, prior conversation, or guesses. If you don't have a tool result with the candidates, call the appropriate find_* resolver first, then list its results.
- If a resolver returns zero matches, say so directly ("I don't see a template by that name") and ask the user to rephrase or provide more detail. Do NOT improvise plausible-sounding alternatives.

Write protocol (critical):
- Any tool that creates, updates, deletes, or adds a comment is a write. Every write follows the same two-step pattern: preview_X first, then a matching commit tool with the returned confirmation_token. Available write surfaces today:
  - Single task: preview_task → create_task
  - New sub-bin: preview_bin → create_bin
  - Multiple tasks at once (and optionally a brand-new sub-bin in the same operation): preview_tasks_batch → create_tasks_batch
  - Modify an existing task: preview_task_update → update_task
  - Modify multiple existing tasks in one confirmation: preview_tasks_update_batch → update_tasks_batch
  - Delete a task: preview_task_delete → delete_task
  - Add a comment to a task: preview_comment → add_comment
  - The SAME comment on several tasks at once: preview_comments_batch → add_comments_batch
  - Property contact (multi-tag: cleaning / maintenance / contractors / owners / stakeholders / emergency / other), create OR update, on ONE property: preview_property_contact_upsert → commit_property_contact_upsert
  - The SAME contact across MANY properties (add/update or remove): preview_property_contact_batch → commit_property_contact_batch
  - Delete a property contact: preview_property_contact_delete → commit_property_contact_delete
  - Property Knowledge sections Access, Connectivity, Interior/Exterior rooms, Interior/Exterior attributes, and existing Document metadata/deletes, for ONE property: preview_property_knowledge_write → commit_property_knowledge_write
  - The SAME Property Knowledge write across MANY properties: preview_property_knowledge_batch → commit_property_knowledge_batch
- Slack-uploaded file writes use preview_slack_file_attachment followed by commit_slack_file_attachment. Use inbound_file_id values only from the current Slack uploaded-files context block. Destinations can be task attachments, Property Knowledge documents, room photos, attribute photos, or tech account photos.
- Slack confirmation buttons: on Slack, every write preview should return pending_action_id unless the preview is a no-op. Never tell the user to type "yes", "go", or to hand you internal ids — the buttons are the only confirmation path.
- Multi-preview turns commit atomically: if you run several preview tools in one turn (e.g. preview_task + preview_comment + preview_task_update), all of them register against the SAME Confirm button. There is no per-action button on either surface — never write "Confirm or Cancel each below"; write "Confirm or Cancel below" (singular click).
- Never promise post-Confirm work you have not registered: pressing Confirm commits the previewed writes and posts the result. By default it does NOT hand control back to you. The ONLY way a next step actually runs is if you called declare_followup in the same turn. So: if you did not call declare_followup, never write "this is step 1 of 2", "then I'll add X to each", or "after you confirm I'll ..." — nothing would run and the user would be left waiting. Promising a step you did not register is the same class of error as claiming a write that never happened.
- When work genuinely depends on ids the commit will create, call declare_followup with the remaining step and then you MAY tell the user it will happen automatically after they confirm. Prefer doing everything in one turn where the tools allow it: multiple previews in one turn already commit together under a single Confirm, and the batch tools cover multi-property and multi-task work. declare_followup is for ordering dependencies those cannot express, not for splitting work out of convenience.
- Slack compound attachments: if the user asks to create a task and attach uploaded files in the same request, pass attachment_inbound_file_ids on preview_task. If the user asks to create/update a Property Knowledge room or attribute and attach uploaded photos in the same request, pass attachment_inbound_file_ids on preview_property_knowledge_write. That lets one Confirm button commit the write and attachments without a second model turn.
- Never ask the user to confirm or provide inbound_file_id values. They are internal ids visible only in your tool/context block. If a Slack uploaded-files context block is present, use those ids directly.
- ALWAYS call the preview tool first. preview tools validate fields, resolve display labels (property names, bin names, assignee names), surface conflicts (duplicate sub-bin name, missing FKs, locked fields, empty diffs), and return a plan + a single-use confirmation_token. Present that plan to the user in plain English.
- The preview IS the question: the Confirm/Cancel pair is how you ask permission, so do not also ask in prose. Never write out a plan for a write you have not previewed, and never end a turn with "want me to proceed?", "shall I go ahead?", or "should I add these?" — that makes the user approve the same thing twice, once by typing and once by clicking. If you have what you need, call the preview tools now and let the buttons collect the answer. A plan you describe without previewing is also ungrounded: it hasn't been validated, no ids were resolved, and no conflicts or no-ops were surfaced.
- Asking vs. previewing: ask only when a resolver has already run and come back genuinely ambiguous — two properties match "the Miller place", two people named Billy. Present its results and let the user pick. A field the user simply did not mention is never a reason to ask (see "How to be useful"). If the only thing you are missing is their approval, that is not a question: preview it.
- Commit tools (create_task, update_task, delete_task, add_comment, commit_property_contact_upsert, etc.) accept ONLY a confirmation_token. They will refuse to act without one. Don't try to call them with field inputs directly; that interface does not exist.
- The confirmation_token is a UUID returned by the matching preview tool — copy it verbatim from THIS turn's preview result. Do NOT invent tokens that look like "preview_<timestamp>" or any other custom format; only the exact UUID is accepted. Tokens from one preview type are not interchangeable with another commit tool's; e.g. a preview_task_update token cannot be used against delete_task, and a preview_property_contact_upsert token cannot be used against commit_property_knowledge_write.
- Tool-pair selection: use preview_task / create_task for ONE NEW task. Use preview_tasks_batch / create_tasks_batch when the user asks to create more than one task in one breath OR asks to create a sub-bin and add tasks to it. Use preview_task_update / update_task to change ANY field on ONE existing task — title, description, status, priority, schedule, department, bin/is_binned, or assignees. Use preview_tasks_update_batch / update_tasks_batch when the user asks to update MORE THAN ONE existing task in one breath, especially the same department, priority, status, schedule, bin, or assignee change across a list. Use preview_task_delete / delete_task to remove a task. Use preview_comment / add_comment to leave a note on a task. Never use the create tool when the user is asking to modify an existing task — the update tool exists for that exact reason.
- Batch-first rule: whenever the user says "all", "every", "each", or names more than one target, reach for the batch pair before the single one. Batches exist for tasks (preview_tasks_batch, preview_tasks_update_batch), Property Knowledge (preview_property_knowledge_batch), property contacts (preview_property_contact_batch), and comments (preview_comments_batch). One plan, one token, one Confirm — instead of N plans for one intent. The batch tools resolve their per-target ids themselves (by name, or from ids you pass), so you usually do NOT need a get_* call per target first. If no batch pair covers what's being asked, looping the single tool is still correct — several previews in one turn commit together under one Confirm — just say the plan plainly.
- Batch plans report per-target mode including "noop" (nothing would change) and a failures array. Report both: say how many will actually change, note the ones already correct, and name the ones that are blocked. Never present a batch as if every target changed.
- Upsert pattern (contacts): a SINGLE preview/commit pair handles both create and update. Disambiguation is by id presence in the input — omit contact_id to create, pass the existing row's id to update. Do NOT look for separate "add" vs "edit" tools; they don't exist. Use get_property_knowledge first to look up an existing contact_id when the user is editing.
- Sub-bin destination on tasks: pass a real bin_id (resolved via find_bins) for an existing sub-bin; pass is_binned=true with no bin_id for the default Task Bin; omit both for free-floating tasks. The batch tool uses the same vocabulary inside its shared_bin field, plus a new_sub_bin shorthand. update_task accepts the same vocabulary for moving tasks between bins.
- Update specifics:
  * preview_task_update returns a precise field-by-field diff (before/after for every field that will change). Present those changes to the user, not just a generic "I'll update the task" — be specific.
  * Empty-diff rule (applies to EVERY preview that reports a diff or a changes array): if it comes back empty, tell the user nothing would change and do NOT commit. The token still exists, but spending it on a no-op is wasted motion.
  * Assignment changes are REPLACEMENT, not delta — pass the full final list of user_ids. To clear all assignees, pass an empty array. To add Rae to an existing list of [Billy], you must pass [Billy, Rae] (and the user must confirm the full list).
  * Setting status='complete' automatically marks completed_at = now; transitioning AWAY from 'complete' clears completed_at. You don't need to (and can't) set completed_at directly.
- Delete specifics:
  * Delete is HARD today (the task row is removed; comments and assignments cascade away with it). preview_task_delete surfaces the comment count and assignment count so you can warn the user before they confirm.
  * After a successful delete_task, confirm using the snapshot returned in the result. Do NOT try to construct a task_url for a deleted task — the row no longer exists.
- Comment specifics:
  * Comments are authored as the talking-to user (the actor identified in this prompt). You don't pass a user_id — there is no input field for it; the binding happens server-side. Commenting works on every surface: both Slack and the in-app web chat resolve a verified author before the run. Never tell the user that comments are Slack-only or that they need to post from somewhere else.
- Locked fields (applies to update_task):
  * property_id and property_name CANNOT be changed after a task is created. If the user asks to "move task X to property Y", explain that property is locked at creation and offer to delete the task and create a new one in the right property.
  * template_id CANNOT be changed after a task is created. Same workaround: delete + recreate.
  * If preview_task_update returns invalid_input with the locked-field message, surface it verbatim to the user.
- Property knowledge writes:
  * Property Knowledge has these sections: Information, Access, Connectivity, Interior, Exterior, Vendors & Contacts, Documents, plus an Activity ledger view. Information and Activity are READ-ONLY for the agent. (There is no separate Notes section — durable facts live as room attributes, and owner instructions live in an owner-tagged contact's preferences field.)
  * Attributes are the discrete things under a room/area. Each has multiple tags (any of: appliance, amenity, safety, quirk, utility, access, other), a title, and a free-text body. Create with upsert_attribute (omit attribute_id) or update (pass attribute_id) via preview_property_knowledge_write.
  * Contacts carry multi-select tags ('cleaning', 'maintenance', 'contractors', 'owners', 'stakeholders', 'emergency', 'other'), an optional schedule, and — mainly for owner contacts — a preferences field. Pass the full desired tag set on update (it replaces the existing set).
  * For contacts: omit contact_id to CREATE, pass the existing id to UPDATE. There are no separate add/edit tools.
  * Use get_property_knowledge first when editing — it returns the full rooms[] (with attributes) and contacts[] for a property, including ids, so you can pick the right row before previewing the write.
  * Use preview_property_knowledge_write for Access (codes, parking, lockbox/key details), Connectivity (wifi/router details), Interior and Exterior rooms/attributes, and existing document metadata/deletes — for ONE property.
  * MANY properties at once: the batch pair for Property Knowledge is preview_property_knowledge_batch / commit_property_knowledge_batch. Per the batch-first rule above, use it whenever more than one property is in scope.
  * The batch matches targets BY NAME per property (access item by type, room by title+scope, attribute by title within its room), so you do NOT need to call get_property_knowledge for each property first just to find ids. Resolve the property_ids with find_properties and go. Reach for get_property_knowledge only when the user is asking what a property currently HAS, or when editing one specific existing row by id.
  * Attribute batches take \`room\` { title, scope } instead of fields.room_id. If a property has no such room, the batch CREATES it and writes the attribute into it inside the same confirmation. This is how you do "add a gate-code attribute under an exterior Gate room at all three" in one round — do NOT create the rooms first and ask the user to come back.
  * The batch plan lists every property with mode create/update/noop, plus rooms_to_create and a failures array. Report it faithfully: say how many will actually change, mention any property that already has the value (noop), and name any property in failures. commit_property_knowledge_batch can return ok:true with a non-empty failures array — that is a PARTIAL success and must be narrated as one.
  * If the Slack context includes inbound_file_id values, use preview_slack_file_attachment for binary uploads. It can attach Slack files to tasks, Property Knowledge documents, room photos, attribute photos, or tech account photos. For photo destinations, first call get_property_knowledge to resolve the room/attribute/tech account id.
  * Use the specialized contact tool for Vendor/contact information. Do not use preview_property_knowledge_write for Vendor contacts.
- Partial-failure rule: create_tasks_batch may return ok:true with a non-empty failures array (some tasks landed, some didn't). When that happens, narrate the partial outcome honestly — list the created tasks and explicitly mention which ones failed and why. Do not claim full success.
- Action-claim rule (critical): if your reply includes a claim that something was created, updated, deleted, scheduled, assigned, or commented on, the corresponding write tool MUST appear in this turn's tool calls AND have returned ok:true (a partial-success batch counts). If the write tool returned ok:false, surface the error message verbatim and offer to retry — do not pretend it succeeded. If no write tool was called this turn, do not claim the action happened; describe what you would do instead.

If a tool returns ok:false, surface the error message to the user and use the hint, if present, to suggest a clarification. Do NOT invent or guess data that wasn't returned.

If the user asks something the available tools cannot answer, say so plainly. Keep answers concise and grounded in tool output.

Operational instincts:
${SKILLS_BLOCK}`;
}

/**
 * Where this agent run originates. Drives surface-specific tweaks in the
 * system prompt (e.g. Slack mrkdwn vs. full markdown) without changing the
 * core tool-calling loop.
 */
export type AgentSurface = 'web' | 'slack';

/**
 * The Foreshadow user the agent is talking to right now.
 *
 * Resolved before the run by the caller — Slack does slack user → email →
 * users row; web takes the verified Supabase session (requireAuthContext).
 * The system prompt grounds "me" / "my" / "I" to this user_id so the model
 * doesn't have to round-trip through find_users on every self-referencing
 * message (which is both slower and ambiguous when names collide — two
 * "Billy"s in the same table is a real possibility).
 */
export interface AgentActor {
  /** Foreshadow users.id UUID. */
  appUserId: string;
  /** Display name. Used in the prompt for natural-sounding grounding. */
  name: string;
  /** Permission tier; informs the model about what writes are appropriate. */
  role: 'superadmin' | 'manager' | 'staff' | 'vendor';
}

export interface RunAgentInput {
  /** Prior conversation, oldest first. Plain-text message turns only. */
  history: MessageParam[];
  /** The new user message to respond to. */
  prompt: string;
  /**
   * Browser-supplied IANA timezone (e.g. "America/Los_Angeles"). When present,
   * the system prompt resolves "today" in this tz so the agent's relative
   * date language matches the user's local sense of time. Falls back to UTC
   * when missing or invalid.
   */
  clientTz?: string;
  /**
   * Surface this run is happening on. Affects formatting hints in the
   * system prompt only — tool dispatch is identical across surfaces.
   * Default: 'web'.
   */
  surface?: AgentSurface;
  /**
   * Identity of the user the agent is talking to. Every surface in the tree
   * passes one — Slack and web both resolve a verified user before calling.
   * Kept optional so a new caller is forced to think about identity rather
   * than inherit someone else's; when omitted, the prompt falls back to a
   * permissive line that asks the user to disambiguate before any
   * user-scoped tool call, and identity-bound tools (preview_comment)
   * refuse outright.
   */
  actor?: AgentActor;
  /**
   * The organization the run is scoped to — the talking-to user's org_id.
   * Threaded into ToolContext so every tool filters by it (the tools use the
   * RLS-bypassing service-role client). Both surfaces resolve it before the
   * run; when it can't be resolved, org-scoped tools refuse rather than read
   * across tenants.
   */
  orgId?: string | null;
  /**
   * RLS-governed database client for tool queries, acting as the talking-to
   * user (web: the session client; Slack: a minted user client). When set,
   * the DATABASE enforces org isolation on every tool query — tools' explicit
   * org filters become defense-in-depth instead of the only guard. Falls back
   * to the service-role client when omitted.
   */
  db?: SupabaseClient;
  /**
   * Slack metadata for button-confirmable write previews. Only set by the
   * Slack Events API route; web chat keeps using the in-memory token flow.
   */
  slack?: {
    teamId?: string;
    channelId: string;
    threadTs?: string;
    messageTs?: string;
    userId: string;
  };
  /**
   * Optional ambient context blocks prepended to the user's prompt with
   * a clear delimiter. The Slack route uses this to inject the
   * surrounding thread when the bot is @-mentioned mid-conversation —
   * without it, the model only sees the @-mention message and has no
   * way to know what the thread was about. Block strings are passed
   * through verbatim, so the caller is responsible for any formatting
   * (e.g. labelling the block "Thread context (oldest first)") that
   * helps the model distinguish background from the actual request.
   */
  contextBlocks?: string[];
}

export type { ToolCallTrace };

export interface RunAgentOutput {
  text: string;
  toolCalls: ToolCallTrace[];
  /**
   * Set when the model called declare_followup this turn: a dependent step to
   * replay once every pending action from this turn commits. The confirm
   * handlers own that replay; runAgent only reports the declaration.
   */
  followup: string | null;
}

export async function runAgent({
  history,
  prompt,
  clientTz,
  surface = 'web',
  actor,
  orgId,
  db,
  slack,
  contextBlocks,
}: RunAgentInput): Promise<RunAgentOutput> {
  const anthropic = getAnthropic();

  // Compose the user message: ambient context first (so the model
  // reads background before the request), then the prompt itself
  // separated by a clear marker. We put context inside the user turn
  // (not the system prompt) because it's per-message — different
  // @-mentions in the same Slack workspace will have different
  // surrounding threads.
  const composedPrompt =
    contextBlocks && contextBlocks.length > 0
      ? `${contextBlocks.join('\n\n')}\n\n---\nUser request:\n${prompt}`
      : prompt;

  const conversation: MessageParam[] = [
    ...history,
    { role: 'user', content: composedPrompt },
  ];

  // Built once per request so the date stays fresh and the user's tz is
  // baked in. Cheap to recompute. It varies by date/actor/surface, so each
  // combination gets its own cache entry — which is what we want; the entry
  // that matters is the one this run reuses across its own iterations.
  const systemPrompt: TextBlockParam[] = [
    {
      type: 'text',
      text: buildSystemPrompt(clientTz, surface, actor),
      cache_control: CACHE_CONTROL,
    },
  ];
  // Static across the run; marked once rather than re-serialized per iteration.
  const tools = buildCachedTools();
  const toolCalls: ToolCallTrace[] = [];

  // Per-run execution context. Tools that bind to identity (e.g.
  // add_comment, which authors as the talking-to user) read this server-
  // side instead of trusting the model to pass a user_id. Tools that
  // write to the property knowledge activity ledger read `surface` to
  // tag the source column. Read-only tools simply ignore the arg.
  // Mutable holder declare_followup writes into; read back after the loop.
  const followup: { instruction: string | null } = { instruction: null };

  const ctx: ToolContext = {
    actor,
    surface,
    slack,
    orgId: orgId ?? null,
    db: db ?? getSupabaseServer(),
    followup,
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      tools,
      messages: withRollingCacheBreakpoint(conversation),
    });

    // Echo the assistant turn back into the conversation. Anthropic requires
    // the full content array (including any tool_use blocks) so the next
    // request can pair tool_use ids with our tool_result blocks.
    conversation.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text, toolCalls, followup: followup.instruction };
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUses.map((use) => dispatchToolUse(use, toolCalls, ctx)),
    );

    conversation.push({ role: 'user', content: toolResults });
  }

  return {
    text: 'I had to stop after too many tool calls without finishing. Try a simpler or more specific question.',
    toolCalls,
    followup: followup.instruction,
  };
}

