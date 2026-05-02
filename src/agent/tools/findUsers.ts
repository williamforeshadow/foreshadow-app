import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// find_users — resolve people by name (or role) into user IDs.
//
// Used as a precursor to any tool that takes user_id inputs (today:
// create_task's assigned_user_ids; tomorrow: anything that filters or
// updates by assignee). The agent must NEVER pass a user_id it didn't
// receive from this tool's output in the current turn.

const inputSchema = z.object({
  query: z
    .string()
    .min(2, 'query must be at least 2 characters')
    .optional()
    .describe('Substring search against name and email (case-insensitive).'),
  role: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Exact-match filter on a user's role (e.g. 'admin', 'cleaner', 'manager'). Free-form string column; pass exactly what the user said.",
    ),
  ids: z
    .array(z.string().uuid())
    .optional()
    .describe('Batch lookup by user UUID. Other filters are ignored when set.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max rows to return. Default 25, hard cap 100.'),
});

type Input = z.infer<typeof inputSchema>;

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  avatar: string | null;
}

const SELECT = 'id, name, email, role, avatar';
const DEFAULT_LIMIT = 25;

// Same scrubbing logic find_properties uses — keep names short and human,
// drop characters that would corrupt PostgREST `or()` / ILIKE syntax.
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(input: Input): Promise<ToolResult<UserRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  let query = supabase
    .from('users')
    .select(SELECT)
    .order('name', { ascending: true })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    query = query.in('id', input.ids);
  } else {
    if (input.role) {
      query = query.eq('role', input.role);
    }
    if (input.query) {
      const term = sanitizeSearchTerm(input.query);
      if (term.length > 0) {
        query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
      }
    }
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const rows = (data ?? []) as UserRow[];
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: trimmed,
    meta: { returned: trimmed.length, limit, truncated },
  };
}

export const findUsers: ToolDefinition<Input, UserRow[]> = {
  name: 'find_users',
  description:
    "Find people in the system by name, email, or role. Use this to resolve user names into user_id values that other tools accept (e.g. assigned_user_ids on create_task). When the user names someone ambiguously ('Billy', 'Sarah'), call this and present the matches back to the user for disambiguation rather than guessing. The role column is free-form (e.g. 'admin', 'cleaner', 'manager') — pass it exactly as the user phrased it.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description:
          'Case-insensitive substring match against name and email. Minimum 2 characters.',
      },
      role: {
        type: 'string',
        minLength: 1,
        description:
          "Exact-match filter on the user's role. Free-form string; pass what the user said.",
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by user UUID. When provided, other filters are ignored.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Max rows to return. Default 25.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
