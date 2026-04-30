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
  | 'unknown_tool';

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
}

export type ToolResult<T> =
  | { ok: true; data: T; meta?: ToolMeta }
  | { ok: false; error: ToolError };

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
  handler: (input: TInput) => Promise<ToolResult<TOutput>>;
}
