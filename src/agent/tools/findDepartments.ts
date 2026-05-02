import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// find_departments — resolve department names into department_id values.
//
// Departments are coarse-grained categories ("Cleaning", "Maintenance",
// "Operations") used to group tasks and templates. Names have a unique
// constraint at the DB level, so a query is expected to return at most one
// hit on an exact match and a small number on substring search. Field
// projection is intentionally minimal — agents only need id + name + icon
// for display.

const inputSchema = z.object({
  query: z
    .string()
    .min(2, 'query must be at least 2 characters')
    .optional()
    .describe(
      "Substring search against department name (case-insensitive). Department names are unique, so an exact-match query usually returns one row.",
    ),
  ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'Batch lookup by department UUID. Other filters are ignored when set.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max rows to return. Default 25, hard cap 100.'),
});

type Input = z.infer<typeof inputSchema>;

export interface DepartmentRow {
  id: string;
  name: string;
  icon: string | null;
}

const SELECT = 'id, name, icon';
const DEFAULT_LIMIT = 25;

function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(input: Input): Promise<ToolResult<DepartmentRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  let query = supabase
    .from('departments')
    .select(SELECT)
    .order('name', { ascending: true })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    query = query.in('id', input.ids);
  } else if (input.query) {
    const term = sanitizeSearchTerm(input.query);
    if (term.length > 0) {
      query = query.ilike('name', `%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const rows = (data ?? []) as DepartmentRow[];
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: trimmed,
    meta: { returned: trimmed.length, limit, truncated },
  };
}

export const findDepartments: ToolDefinition<Input, DepartmentRow[]> = {
  name: 'find_departments',
  description:
    "Find departments (e.g. 'Cleaning', 'Maintenance', 'Operations') by name. Use this to resolve a department name into a department_id that other tools accept (create_task, find_tasks, find_templates). Department names are unique — an exact-match query returns at most one row.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description:
          'Case-insensitive substring match against department name. Minimum 2 characters.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by department UUID. When provided, other filters are ignored.',
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
