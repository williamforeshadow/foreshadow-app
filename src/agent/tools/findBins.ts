import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// find_bins — resolve project bin names ("Maintenance", "Front-of-House
// Issues", "Long-term Projects") into bin_id values.
//
// Bins are long-term workspace containers visible in the kanban board /
// bin tab. A task with a bin_id set lives in that bin's view; tasks
// without one are free-floating. The agent uses this tool to translate
// "put it in the maintenance bin" into the bin_id create_task accepts.
// `is_system` flags built-in bins (e.g. an "All" view) the user can't
// rename or delete; expose it as filter + output so the agent can avoid
// suggesting them when the user wants a "real" bin.

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
      'Filter system bins (built-in, non-user-editable) in or out. Omit to include both.',
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
  // agent and the kanban board enumerate bins in the same sequence.
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
    "Find project bins (long-term task containers visible in the kanban board) by name. Use this to resolve a bin name into a bin_id that create_task accepts. A task with bin_id set lives in that bin's view; tasks without one are free-floating. `is_system` flags built-in bins the user can't edit — usually skip these unless the user explicitly references one. Bins are sorted in the same order they appear in the UI.",
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
          'Filter system bins in or out. Omit to include both user and system bins.',
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
