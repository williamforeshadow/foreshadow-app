import { z } from 'zod';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

// find_properties — discover/lookup vacation rental properties.
//
// First and most foundational read tool: it resolves natural-language property
// references ("Beach House") into canonical property IDs that every other
// future tool will accept as input. Mirrors the query pattern in
// app/api/properties/GET.
//
// Naming rules:
//   - `name` is the canonical user-facing display name and the only name field
//     returned. Always refer to a property by `name`.
//   - `hostaway_name` (the upstream Hostaway listing label, often verbose) is
//     searched server-side so a user can refer to a property by its Hostaway
//     name, but it is a match-only identifier and is deliberately NOT returned.
//
// Org scoping: results are filtered to ctx.orgId. The tools run on the service-
// role client (RLS-bypassing), so without this filter a query would return
// every organization's properties.

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

// hostaway_name is intentionally absent from the select — it's filtered against
// (below) but is a match-only identifier, never returned to the model.
const SELECT =
  'id, name, is_active, address_city, address_state, bedrooms, bathrooms, timezone';

const DEFAULT_LIMIT = 25;

// Above this many properties in the org, tier 3 (list everything so the model
// can read the names and choose) stops being reasonable and we return a plain
// empty result instead. 100 names is a modest payload the model can scan; a
// thousand is noise that would crowd out the answer.
const LISTING_FALLBACK_MAX = 100;

/** One ranked candidate from the search_properties() database function. */
interface RankedProperty {
  property_id: string;
  score: number;
  matched_in: string;
}

/**
 * How the returned rows were arrived at. Surfaced in meta so the model can
 * tell matches from guesses — the distinction the three-tier fallback makes
 * possible and which would be dangerous to hide.
 */
type MatchMode = 'exact' | 'fuzzy' | 'listing_all';

// Strip characters that would confuse PostgREST's `or()` filter syntax or
// inject ILIKE wildcards. Property names are short and human; this is plenty.
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<PropertyRow[]>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const limit = input.limit ?? DEFAULT_LIMIT;
  // ctx.db is RLS-governed on authenticated surfaces — the DB enforces org
  // isolation; the explicit org filter below is defense-in-depth.
  const supabase = ctx.db;

  // Pull `limit + 1` so we can detect truncation without a separate count.
  // org_id filter applies even for id-based lookups so a cross-org id can't be
  // resolved.
  let query = supabase
    .from('properties')
    .select(SELECT)
    .eq('org_id', org)
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

  // Tiers 2 and 3 only apply to a text search that found nothing. An `ids`
  // lookup returning nothing means those ids don't exist, and guessing at
  // replacements for a specific id would be exactly the fabrication the
  // identifier rules exist to prevent.
  if (rows.length === 0 && input.query && !input.ids) {
    return resolveWithFallbacks(supabase, input, org, limit);
  }

  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: trimmed,
    meta: {
      returned: trimmed.length,
      limit,
      truncated,
      ...(input.query ? { match_mode: 'exact' as MatchMode } : {}),
    },
  };
}

/**
 * Tier 2 then tier 3, after an exact substring search came back empty.
 *
 * Tier 2 is fuzzy matching, which catches misspellings and near-misses that a
 * substring can't — "Acqua Vista" finding "Aqua Vista #508".
 *
 * Tier 3 returns the org's whole property list. This looks blunt and it is,
 * but it mirrors what actually happens today when an operator says "look
 * again": the model re-calls this tool with no query, reads the names, and
 * identifies the property immediately. The capability was always there; it
 * just cost a turn and a nudge to reach. Doing it here removes both.
 *
 * Tier 3 also handles something no lexical technique can. "The beach place"
 * shares no usable substring with "Pacific Beach Escape" and trigram won't
 * bridge it either, but a model reading forty names picks it out instantly.
 * At this scale, showing the list solves the vocabulary-mismatch problem that
 * would otherwise need embeddings.
 */
async function resolveWithFallbacks(
  supabase: ToolContext['db'],
  input: Input,
  org: string,
  limit: number,
): Promise<ToolResult<PropertyRow[]>> {
  const activeOnly = input.is_active ?? true;

  // --- Tier 2: fuzzy ---
  // The term goes over as an RPC parameter rather than into a filter string,
  // so it needs no sanitizing here.
  const { data: ranked, error: rankErr } = await supabase.rpc(
    'search_properties',
    {
      p_org: org,
      p_query: (input.query ?? '').trim(),
      p_limit: limit,
      p_active_only: activeOnly,
    },
  );
  if (rankErr) {
    return { ok: false, error: { code: 'db_error', message: rankErr.message } };
  }

  const matches = (ranked ?? []) as RankedProperty[];
  if (matches.length > 0) {
    const byId = new Map(matches.map((m) => [m.property_id, m]));
    const { data: fuzzyRows, error: fuzzyErr } = await supabase
      .from('properties')
      .select(SELECT)
      .eq('org_id', org)
      .in('id', Array.from(byId.keys()));
    if (fuzzyErr) {
      return { ok: false, error: { code: 'db_error', message: fuzzyErr.message } };
    }
    const sorted = ((fuzzyRows ?? []) as PropertyRow[]).sort(
      (a, b) => (byId.get(b.id)?.score ?? 0) - (byId.get(a.id)?.score ?? 0),
    );
    return {
      ok: true,
      data: sorted,
      meta: {
        returned: sorted.length,
        limit,
        truncated: false,
        match_mode: 'fuzzy' as MatchMode,
        exact_matches: 0,
        note: `No property name contains "${input.query}" exactly. These are the closest matches by spelling, best first. Confirm with the user before treating one as certain.`,
      },
    };
  }

  // --- Tier 3: list everything ---
  const { data: allRows, error: allErr } = await supabase
    .from('properties')
    .select(SELECT)
    .eq('org_id', org)
    .eq('is_active', activeOnly)
    .order('name', { ascending: true })
    .limit(LISTING_FALLBACK_MAX + 1);
  if (allErr) {
    return { ok: false, error: { code: 'db_error', message: allErr.message } };
  }

  const all = (allRows ?? []) as PropertyRow[];
  if (all.length === 0 || all.length > LISTING_FALLBACK_MAX) {
    // Too many to usefully eyeball (or genuinely none). Fall back to an honest
    // empty rather than dumping hundreds of names.
    return {
      ok: true,
      data: [],
      meta: {
        returned: 0,
        limit,
        truncated: false,
        match_mode: 'exact' as MatchMode,
        exact_matches: 0,
        note: `Nothing matched "${input.query}", by exact or approximate spelling. Ask the user which property they mean.`,
      },
    };
  }

  return {
    ok: true,
    data: all,
    meta: {
      returned: all.length,
      limit,
      truncated: false,
      match_mode: 'listing_all' as MatchMode,
      exact_matches: 0,
      note: `NOTHING matched "${input.query}" by spelling, so this is the COMPLETE list of properties in this organization, not a set of matches. Read the names and decide whether one of them is what the user meant — they may have used a nickname, a shortened form, or a description rather than the stored name. If one clearly fits, use it. If several might, ask the user to choose between those. If none fit, say so.`,
    },
  };
}

export const findProperties: ToolDefinition<Input, PropertyRow[]> = {
  name: 'find_properties',
  description:
    "Find vacation rental properties by name or active status. Use this to resolve property names mentioned by the user into canonical property IDs that other tools accept. `name` is a property's canonical display name — always refer to a property by `name`. The search also matches the upstream Hostaway listing label and the address internally, but those are not returned. IMPORTANT — a `query` that matches nothing degrades instead of failing, and meta.match_mode tells you which happened: 'exact' means these are real substring matches; 'fuzzy' means nothing matched exactly and these are the closest spellings (good candidates, but confirm before acting); 'listing_all' means nothing matched at all and you are being handed the COMPLETE property list so you can read the names yourself. On 'listing_all', do NOT report that the property could not be found without first checking the list — the user may have used a nickname, a shortened form, or a description ('the beach place') rather than the stored name. Pick the one that fits, ask the user to choose between a few, or say none fit — but look first.",
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
