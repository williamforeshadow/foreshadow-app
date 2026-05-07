import type { ZodType } from 'zod';
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
 * The actor is the same `AgentActor` runAgent() received: Slack resolves
 * it via email match, in-app chat doesn't have real auth yet so it may
 * be undefined. Tools that REQUIRE an actor (the comment tools) must
 * fail loudly with a clear error code when ctx.actor is missing rather
 * than silently picking a stand-in.
 */
export interface ToolContext {
  actor?: {
    appUserId: string;
    name: string;
    role: 'superadmin' | 'manager' | 'staff';
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
}

export interface ToolDefinition<TInput, TOutput> {
  /** Stable identifier the LLM uses when invoking the tool. snake_case. */
  name: string;
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
