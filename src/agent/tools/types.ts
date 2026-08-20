import type { ZodType } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// Shared shapes used by every tool.
//
// Tools never throw to the LLM. They return a uniform `ToolResult` envelope so
// the model can pattern-match on `ok` and self-correct using `error.hint` when
// it provides bad input or asks about something that doesn't exist.

export type ToolErrorCode =
  | 'invalid_input'
  | 'db_error'
  | 'not_found'
  | 'unknown_tool'
  /**
   * Write tools refuse to act without an in-turn confirmation token from
   * their paired preview tool. Surfaces when the model tries to skip the
   * preview/confirm dance, when a token has expired (5-minute TTL), or
   * when a token has already been used.
   */
  | 'confirmation_required'
  /**
   * Bin creation hit a name conflict (case-insensitive). The hint will
   * usually steer the model toward find_bins so it can reuse the
   * existing sub-bin instead of inventing a near-duplicate.
   */
  | 'duplicate_name'
  /**
   * Batch write failed partway through. `error.message` describes which
   * item failed and why; the model should report the partial outcome
   * to the user honestly rather than claim full success.
   */
  | 'partial_failure';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  /** Optional natural-language nudge for the LLM, e.g. "did you mean…" */
  hint?: string;
}

export interface ToolMeta {
  /** Number of rows actually returned in `data`. */
  returned: number;
  /** Effective limit applied to this call. */
  limit: number;
  /** True when more rows existed than `limit` allowed. */
  truncated: boolean;
  /**
   * Tools may attach extra disambiguation context (e.g. resolved name → id
   * matches) so the model can mention them in its answer.
   */
  [key: string]: unknown;
}

export type ToolResult<T> =
  | { ok: true; data: T; meta?: ToolMeta }
  | { ok: false; error: ToolError };

/**
 * Per-call execution context the dispatcher hands to every tool handler.
 * Today this is just the resolved actor (when known), used by tools that
 * bind a server-side identity to the write — e.g. add_comment authors
 * the comment as the talking-to user without trusting the model to pass
 * a user_id. Handlers that don't need this can ignore the parameter.
 *
 * The actor is the same `AgentActor` runAgent() received: Slack resolves it
 * via email match, web via the verified Supabase session. Both surfaces
 * always supply one, but the field stays optional so tools that REQUIRE an
 * actor (the comment tools) fail loudly with a clear error code rather than
 * silently picking a stand-in if a future surface forgets.
 */
export interface ToolContext {
  /**
   * Today's date (YYYY-MM-DD) in the talking-to user's timezone, resolved by
   * the caller from the browser/Slack tz. The dispatcher injects it into any
   * tool flagged `injectReferenceDate` so date-relative filters ("overdue",
   * "current", "upcoming") align with the user's local clock — the model
   * never sees or passes this value. Absent on callers with no user clock;
   * handlers then fall back to today UTC.
   */
  referenceDate?: string;
  /**
   * The agent_sessions row this run belongs to (web chat). propose_task
   * stamps it onto proposal rows for audit; absent on surfaces without
   * session-scoped proposals.
   */
  sessionId?: string;
  /**
   * Database client for tool queries. On authenticated surfaces this is
   * RLS-GOVERNED (the web session client, or a minted user client for Slack) —
   * the database itself scopes every query to the acting user's org, so a
   * forgotten filter cannot cross tenants. On session-less paths (concierge
   * webhook drafts) it falls back to the service-role client, where the
   * context-bound draft tools + explicit org filters remain the guard.
   * Tools keep their explicit `.eq('org_id', …)` filters as defense-in-depth
   * either way.
   */
  db: SupabaseClient;
  /**
   * The organization the agent is acting for — resolved server-side from the
   * talking-to user's `users.org_id`. EVERY org-scoped tool query MUST filter
   * by this: even with an RLS-governed `db`, the explicit filter is the
   * defense-in-depth floor (and the only guard on service-role fallbacks).
   * Null only when the caller couldn't resolve an org; org-scoped tools must
   * then refuse (via requireOrgId) rather than leak another org's data.
   */
  orgId: string | null;
  actor?: {
    appUserId: string;
    name: string;
    role: 'superadmin' | 'manager' | 'staff' | 'vendor';
  };
  /**
   * Surface this run originates on. Tools that write to audit/activity
   * ledgers use this to set the `source` column ('agent_slack' vs
   * 'agent_web') so a future ledger UI can distinguish where each
   * change came from. Mirrors AgentSurface in runAgent.ts.
   */
  surface?: 'web' | 'slack';
  /**
   * Slack message identity for durable button confirmations. Present only
   * when surface='slack'. Preview tools use it to persist a pending action
   * that /api/slack/interactivity can commit without another LLM turn.
   */
  slack?: {
    teamId?: string;
    channelId: string;
    threadTs?: string;
    messageTs?: string;
    userId: string;
  };
  /**
   * Mutable holder the declare_followup tool writes into, so a turn can say
   * "there is a dependent second step after this commit". runAgent creates it,
   * reads it back after the loop, and returns it as RunAgentOutput.followup;
   * the confirm handlers replay it once every action in the bundle commits.
   *
   * Absent on surfaces that have no confirm step to continue from (e.g. the
   * Concierge sub-agent), which makes declare_followup a no-op there.
   */
  followup?: { instruction: string | null };
  /**
   * Set only when running inside the Concierge guest-reply sub-agent. Binds the
   * one property the draft is for, so guest-facing tools
   * (get_property_knowledge_for_guest) read the property from context rather
   * than trusting the model — the Concierge cannot reach another property's data.
   */
  draft?: {
    propertyId: string | null;
    /**
     * The canonical channel the guest is messaging on (airbnb / vrbo /
     * bookingcom / direct / …), from the conversation. Lets channel-aware
     * tools (find_available_properties) link a guest only to listings on
     * THEIR own OTA — never cross-channel. Null when unknown.
     */
    channel?: string | null;
    /**
     * Which training category this draft is — 'reply' for the guest-reply
     * draft, 'task' for task triage. get_concierge_procedure uses it to load
     * the matching situational rules. Defaults to 'reply' when unset.
     */
    category?: 'reply' | 'task';
  };
}

/**
 * Guard for org-scoped tools. Returns the org id when present, or a ready-to-
 * return ToolResult error envelope when the run has no org context. Usage:
 *
 *   const org = requireOrgId(ctx);
 *   if (typeof org !== 'string') return org;   // no org → refuse, don't leak
 *   ...query.eq('org_id', org)
 */
export function requireOrgId(
  ctx: ToolContext,
): string | { ok: false; error: ToolError } {
  if (!ctx.orgId) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message:
          'No organization is set for this agent session, so org-scoped data cannot be read.',
      },
    };
  }
  return ctx.orgId;
}

export interface ToolDefinition<TInput, TOutput> {
  /** Stable identifier the LLM uses when invoking the tool. snake_case. */
  name: string;
  /**
   * Surfaces this tool is offered on. Omit for every surface. Used to split
   * the task-creation path: web proposes durable cards (propose_task) while
   * Slack keeps the preview/commit token flow (no card surface there).
   */
  surfaces?: ReadonlyArray<'web' | 'slack'>;
  /**
   * When true, the dispatcher overwrites `reference_date` on the tool's input
   * with ToolContext.referenceDate before validation. The field stays in the
   * zod inputSchema (it's how the value reaches the handler) but is omitted
   * from jsonSchema — the model doesn't know it exists.
   */
  injectReferenceDate?: boolean;
  /** Plain-language description shown to the LLM. */
  description: string;
  /** Runtime validator. Tool inputs are validated before `handler` runs. */
  inputSchema: ZodType<TInput>;
  /**
   * JSON Schema describing the same input. Hand-written for now so we
   * control exactly what the LLM sees; we'll consider auto-deriving from
   * Zod once the catalog grows. Typed against Anthropic's `Tool.InputSchema`
   * so it stays compatible with the `tools` argument on `messages.create`.
   */
  jsonSchema: Tool.InputSchema;
  /**
   * Receives the validated input plus the optional execution context.
   * The context arg is positional and optional — read-only tools that
   * don't care simply omit it from their signature.
   */
  handler: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>;
}
