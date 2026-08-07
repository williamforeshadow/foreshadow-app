import type {
  BetaMessageParam,
  BetaContentBlockParam,
  BetaTool,
  BetaToolUseBlock,
  BetaToolResultBlockParam,
  BetaTextBlock,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { toAnthropicTools } from './tools';
import type { ToolContext } from './tools/types';
import { dispatchToolUse, type ToolCallTrace } from './dispatch';
import { claimsConfirmButton, extractPendingActionIds } from './claims';
import { getAnthropic, MODEL, FILES_BETA } from './anthropic';
import {
  buildSystemPrompt,
  type AgentActor,
  type AgentSurface,
} from './prompt/core';

// The system prompt lives in ./prompt — core.ts for what every surface shares,
// web.ts / slack.ts for what they genuinely don't. Re-exported here so the
// existing import sites don't have to care where it moved.
export { buildSystemPrompt };
export type { AgentActor, AgentSurface };

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
  'preview_file_attachment',
  'commit_file_attachment',
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
//
// Raised again to 4096 when the agent gained sight. "Read me the numbers off
// this invoice" and "what does this spreadsheet say" produce genuinely long
// answers, and a truncated one reads to the user as the vision feature being
// broken rather than as a token cap.
const MAX_TOKENS = 4096;
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

// Fed back as a user turn when the model claims a Confirm button it never
// created. Phrased as a correction to act on rather than a scolding: the goal
// is a staged write on the next turn, not an apology to the user (who has not
// seen anything yet and never will see the discarded attempt).
const PHANTOM_BUTTON_CORRECTION =
  'Your last reply pointed at a Confirm button, but you did not call any preview tool this turn, so no button exists and the user would be left waiting for one. Fix it now: if you have enough to stage the write — a title alone is enough for a task — call the appropriate preview tool and then give the plan. If you genuinely cannot stage it, reply again without mentioning buttons or confirming, and say plainly what you need. Do not apologize or mention this correction; the user never saw the previous attempt.';

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
//   3. the end of history — only when history carries media; see below
//   4. the last message  — rolling; see withRollingCacheBreakpoint
//
// All four when a conversation has attachments in it, three otherwise. #3 is
// armed rather than permanent because it is the one that earns its keep only
// sometimes: a replayed image is ~4,800 input tokens, and without a breakpoint
// behind it the model re-reads every image in the conversation at full price on
// the first iteration of every new turn. For a text-only session that same
// breakpoint would buy nothing and spend the last slot.
const CACHE_CONTROL = { type: 'ephemeral' } as const;

/**
 * Serialize the registry and mark the final tool as a cache breakpoint.
 *
 * The registry is static per process, so this is hoisted out of the loop and
 * the resulting array is reused across every iteration of a run.
 */
function buildCachedTools(): BetaTool[] {
  const tools = toAnthropicTools() as BetaTool[];
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
function withRollingCacheBreakpoint(
  messages: BetaMessageParam[],
): BetaMessageParam[] {
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
    { ...last, content: blocks } as BetaMessageParam,
  ];
}

/**
 * Anthropic file ids named in a 400, if that's what this error is.
 *
 * Matched off the message text rather than a structured field because the API
 * reports these as an ordinary invalid_request_error. Narrow deliberately: we
 * only want to trigger the recovery path when the request was rejected FOR the
 * attachments, never on an unrelated 400 that happens to quote an id.
 */
function staleFileIdsFrom(err: unknown): string[] {
  const status = (err as { status?: number } | null)?.status;
  if (status !== 400) return [];
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (!/file[_ ]?id|file_[A-Za-z0-9]/i.test(message)) return [];
  return [...new Set(message.match(/file_[A-Za-z0-9_-]+/g) ?? [])];
}

/** The same message with every image/document block removed. */
function withoutMediaBlocks(message: BetaMessageParam): BetaMessageParam {
  if (typeof message.content === 'string') return message;
  const kept = message.content.filter(
    (block) => block.type !== 'image' && block.type !== 'document',
  );
  if (kept.length === message.content.length) return message;
  // A turn whose only content was a photo would otherwise become an empty
  // array, which the API rejects — leave a placeholder the model can explain.
  return {
    ...message,
    content:
      kept.length > 0
        ? kept
        : [{ type: 'text', text: '[attachment unavailable]' }],
  };
}

/**
 * Mark rows so the next turn re-uploads them.
 *
 * Fire-and-forget: this is self-healing, not part of answering the question in
 * front of us. Imported lazily so the prep module's WASM and document parsers
 * stay out of the graph of every turn that never hits this path.
 */
async function invalidateStaleFiles(anthropicFileIds: string[]): Promise<void> {
  try {
    const { invalidateVisionArtifacts } = await import(
      '@/src/server/agent/inboundFileVisionPrep'
    );
    await invalidateVisionArtifacts(anthropicFileIds);
  } catch (err) {
    console.warn('[agent] could not invalidate stale file rows', err);
  }
}

export interface RunAgentInput {
  /**
   * Prior conversation, oldest first. Mostly plain-text turns, plus media
   * blocks pinned to the turn that carried them (see loadReplayedHistory) —
   * a photo lives at the message it arrived on, not on the current one.
   */
  history: BetaMessageParam[];
  /** The new user message to respond to. */
  prompt: string;
  /**
   * Images and documents attached to THIS turn. Placed ahead of the prompt
   * text: Anthropic's guidance is that images before text outperform images
   * after or interleaved with it.
   */
  promptMedia?: BetaContentBlockParam[];
  /**
   * Set when `history` carries media blocks. Arms the history cache
   * breakpoint (see CACHE_CONTROL above) so replayed attachments are paid for
   * once rather than on every turn.
   */
  historyHasMedia?: boolean;
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
  promptMedia,
  historyHasMedia,
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

  // Stay a plain string when there's no media. History turns arrive as strings
  // and the rolling breakpoint only ever promotes the LAST message, so making
  // this an array unconditionally would change the wire form of every existing
  // conversation's prefix — one avoidable cache miss on every live session, in
  // exchange for nothing.
  const userTurn: BetaMessageParam =
    promptMedia && promptMedia.length > 0
      ? {
          role: 'user',
          content: [
            ...promptMedia,
            { type: 'text', text: composedPrompt } satisfies BetaTextBlockParam,
          ],
        }
      : { role: 'user', content: composedPrompt };

  // Breakpoint 3 of 4 — see CACHE_CONTROL. withRollingCacheBreakpoint already
  // does exactly this job (mark the last block of the last message), so the
  // history prefix reuses it rather than growing a near-duplicate helper.
  const priorTurns =
    historyHasMedia && history.length > 0
      ? withRollingCacheBreakpoint(history)
      : history;

  const conversation: BetaMessageParam[] = [...priorTurns, userTurn];

  // Built once per request so the date stays fresh and the user's tz is
  // baked in. Cheap to recompute. It varies by date/actor/surface, so each
  // combination gets its own cache entry — which is what we want; the entry
  // that matters is the one this run reuses across its own iterations.
  const systemPrompt: BetaTextBlockParam[] = [
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

  // Guards the one-shot phantom-button correction below.
  let selfCorrectedPhantomButton = false;

  // One-shot guard for the media-stripping recovery below.
  let droppedUnreadableMedia = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response;
    try {
      response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'disabled' },
        system: systemPrompt,
        tools,
        messages: withRollingCacheBreakpoint(conversation),
        betas: [FILES_BETA],
      });
    } catch (err) {
      // A file_id the API can't resolve — deleted on Anthropic's side, or a
      // row uploaded under a different API key — rejects the WHOLE request.
      // Every other attachment failure degrades to a sentence; this one would
      // cost the user their answer, so it's the one worth recovering from.
      //
      // Strip the media, mark the rows for re-upload, and run the turn again
      // as text. Once per run: if it fails again it isn't the attachments.
      const staleIds = staleFileIdsFrom(err);
      if (droppedUnreadableMedia || staleIds.length === 0) throw err;

      droppedUnreadableMedia = true;
      console.warn('[agent] dropping unresolvable file references', staleIds);
      void invalidateStaleFiles(staleIds);

      for (let m = 0; m < conversation.length; m++) {
        conversation[m] = withoutMediaBlocks(conversation[m]);
      }
      conversation.push({
        role: 'user',
        content:
          'System note: one or more attachments in this conversation could not be loaded and are not visible to you on this turn. Answer from the text alone, say plainly that you cannot see them right now, and offer to have the user re-send anything you need to look at.',
      });
      i -= 1; // the failed attempt shouldn't burn an iteration
      continue;
    }

    // Echo the assistant turn back into the conversation. Anthropic requires
    // the full content array (including any tool_use blocks) so the next
    // request can pair tool_use ids with our tool_result blocks.
    conversation.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      // Phantom-button self-correction. The model sometimes writes the plan
      // and the "Confirm below" line without ever calling the preview tool
      // that would create those buttons — the reply reads like success while
      // nothing is staged, and the user waits under it for a control that
      // never appears.
      //
      // Rather than shipping that and apologizing (which is what the mask in
      // backstops.ts does, and which still costs the user a round trip), spend
      // one more iteration: tell the model what's wrong and let it either
      // stage the write for real or drop the button language. The user only
      // ever sees the corrected turn.
      //
      // Once per run. If the model ignores the correction, stop and let the
      // backstop mask handle it rather than spending iterations the real work
      // may still need — a model that refused the explicit instruction once is
      // not obviously going to take it the second time.
      if (
        !selfCorrectedPhantomButton &&
        claimsConfirmButton(text) &&
        extractPendingActionIds(toolCalls).length === 0
      ) {
        selfCorrectedPhantomButton = true;
        conversation.push({ role: 'user', content: PHANTOM_BUTTON_CORRECTION });
        continue;
      }

      return { text, toolCalls, followup: followup.instruction };
    }

    const toolUses = response.content.filter(
      (b): b is BetaToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: BetaToolResultBlockParam[] = await Promise.all(
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

