import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// find_properties — discover/lookup vacation rental properties.
//
// First and most foundational read tool: it resolves natural-language property
// references ("Beach House") into canonical property IDs that every other
// future tool will accept as input. Mirrors the query pattern in
// app/api/properties/GET.
//
// Naming rules the agent should follow (encoded in `description` below so the
// model sees them):
//   - `name` is the canonical user-facing display name — the ONLY name field
//     returned. Each result object is exactly one property.
//   - `hostaway_name` (the upstream Hostaway listing label, often verbose e.g.
//     "2650 Broadway 211 Golden Hill Condo") is still searched server-side so a
//     user can refer to a property by its Hostaway name — but it is deliberately
//     NOT returned. Surfacing it made the model treat a single property's two
//     name fields as two separate properties (e.g. "Golden Hill" vs "Golden
//     Hill Condo"), so it stays match-only.

const inputSchema = z.object({
  query: z
    .string()
    .min(2, 'query must be at least 2 characters')
    .optional()
    .describe('Substring search against name and hostaway_name'),
  is_active: z
    .boolean()
    .optional()
    .describe('Filter by active status. Defaults to true.'),
  ids: z
    .array(z.string().uuid())
    .optional()
    .describe('Batch lookup by property UUID. Other filters are ignored when set.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max rows to return. Default 25, hard cap 100.'),
});

type Input = z.infer<typeof inputSchema>;

export interface PropertyRow {
  id: string;
  name: string;
  is_active: boolean;
  address_city: string | null;
  address_state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  timezone: string | null;
}

// hostaway_name is intentionally absent — it's filtered against (below) but
// never returned, so the model can't mistake a property's Hostaway label for a
// separate property.
const SELECT =
  'id, name, is_active, address_city, address_state, bedrooms, bathrooms, timezone';

const DEFAULT_LIMIT = 25;

// Strip characters that would confuse PostgREST's `or()` filter syntax or
// inject ILIKE wildcards. Property names are short and human; this is plenty.
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(input: Input): Promise<ToolResult<PropertyRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  // Pull `limit + 1` so we can detect truncation without a separate count.
  let query = supabase
    .from('properties')
    .select(SELECT)
    .order('name', { ascending: true })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    query = query.in('id', input.ids);
  } else {
    const activeFilter = input.is_active ?? true;
    query = query.eq('is_active', activeFilter);

    if (input.query) {
      const term = sanitizeSearchTerm(input.query);
      if (term.length > 0) {
        query = query.or(
          `name.ilike.%${term}%,hostaway_name.ilike.%${term}%`,
        );
      }
    }
  }

  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message },
    };
  }

  const rows = (data ?? []) as PropertyRow[];
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: trimmed,
    meta: { returned: trimmed.length, limit, truncated },
  };
}

export const findProperties: ToolDefinition<Input, PropertyRow[]> = {
  name: 'find_properties',
  description:
    "Find vacation rental properties by name or active status. Use this to resolve property names mentioned by the user into canonical property IDs that other tools accept. Each object in the result is exactly ONE property; `name` is its canonical display name — always refer to a property by `name`. The search also matches the upstream Hostaway listing label internally (so a user can mention a property by that label), but that label is NOT returned and must never be treated as, or split into, a separate property.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description:
          'Case-insensitive substring match against property name and hostaway_name. Minimum 2 characters.',
      },
      is_active: {
        type: 'boolean',
        description:
          'Filter by active status. Defaults to true (only active properties) when omitted.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by property UUID. When provided, other filters are ignored.',
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
