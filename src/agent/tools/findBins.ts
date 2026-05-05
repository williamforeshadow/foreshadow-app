import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// find_bins — resolve sub-bin names ("Maintenance", "Front-of-House
// Issues", "2026 Goals") into bin_id values.
//
// Mental model:
//   - The "Task Bin" is the default destination for any binned task. It is
//     surfaced in the UI as a single tile and persisted as a system bin row
//     (is_system=true). Tasks land in the Task Bin when is_binned=true AND
//     bin_id IS NULL — there is no UUID to pass for it.
//   - "Sub-bins" are user-created containers (is_system=false) for finer
//     organization within the binned-tasks workspace.
//   - Tasks with is_binned=false are free-floating (not in any bin).
//
// The agent uses this tool to translate "put it in the maintenance sub-bin"
// into the bin_id that create_task accepts. To put a task in the Task Bin
// itself, omit bin_id (or pass null) on create_task and set is_binned=true.
// `is_system` flags the protected Task Bin row; the agent should usually
// skip it when the user references a "real" sub-bin by name.

const inputSchema = z.object({
  query: z
    .string()
    .min(2, 'query must be at least 2 characters')
    .optional()
    .describe('Substring search against bin name (case-insensitive).'),
  is_system: z
    .boolean()
    .optional()
    .describe(
      'Filter the system bin (the protected "Task Bin" row, is_system=true) in or out. Omit to include both the Task Bin and all sub-bins. Pass false to list only sub-bins (the usual case when the user names one).',
    ),
  ids: z
    .array(z.string().uuid())
    .optional()
    .describe('Batch lookup by bin UUID. Other filters are ignored when set.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max rows to return. Default 25, hard cap 100.'),
});

type Input = z.infer<typeof inputSchema>;

export interface BinRow {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number | null;
}

const SELECT = 'id, name, description, is_system, sort_order';
const DEFAULT_LIMIT = 25;

function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(input: Input): Promise<ToolResult<BinRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  // Match the UI's natural order: sort_order asc, then name asc, so the
  // agent and the bins picker enumerate bins in the same sequence.
  let query = supabase
    .from('project_bins')
    .select(SELECT)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    query = query.in('id', input.ids);
  } else {
    if (typeof input.is_system === 'boolean') {
      query = query.eq('is_system', input.is_system);
    }
    if (input.query) {
      const term = sanitizeSearchTerm(input.query);
      if (term.length > 0) {
        query = query.ilike('name', `%${term}%`);
      }
    }
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const rows = (data ?? []) as BinRow[];
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: trimmed,
    meta: { returned: trimmed.length, limit, truncated },
  };
}

export const findBins: ToolDefinition<Input, BinRow[]> = {
  name: 'find_bins',
  description:
    "Resolve a sub-bin name into a bin_id that create_task accepts. The bins workspace has one protected \"Task Bin\" (is_system=true; the default destination — pass null/omit bin_id on create_task to use it) plus zero or more user-created sub-bins (is_system=false). A binned task with bin_id set lives in that sub-bin; binned tasks without one live in the Task Bin; unbinned tasks are free-floating. The agent should usually pass `is_system: false` to list only sub-bins when the user references one by name. Bins are sorted in the same order they appear in the UI.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description:
          'Case-insensitive substring match against bin name. Minimum 2 characters.',
      },
      is_system: {
        type: 'boolean',
        description:
          'Filter the protected Task Bin row in or out. Omit to include both the Task Bin and all sub-bins; pass false to list only sub-bins.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by bin UUID. When provided, other filters are ignored.',
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
