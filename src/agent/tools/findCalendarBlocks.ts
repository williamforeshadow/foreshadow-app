import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolError, ToolMeta, ToolResult } from './types';

// find_calendar_blocks — discover manual/maintenance unavailability that is NOT
// a reservation.
//
// Blocks are the operator's "this property is unavailable but nobody's staying"
// signal: a maintenance hold, an owner-requested close-down, a deep-clean day.
// On the Hostaway calendar they come through as status 'blocked' (no reservation
// behind them) and land in the standalone `calendar_blocks` table — deliberately
// separate from `reservations` because they carry no guest, no revenue, and get
// NO automations (the automation engine is reservation-only and never reads this
// table).
//
// The boundary the model must respect (spelled out in the description too):
//   - Guest bookings AND owner stays are reservations → use find_reservations
//     (filter kind='owner_stay' for owner-reserved dates). They are NOT here.
//   - Maintenance / manual blocks are the only thing in this table.
// So "is anything blocked next week" → this tool; "is the owner staying" →
// find_reservations. Conflating them is the easy mistake; the description warns
// against it.
//
// calendar_blocks dates are BOTH inclusive (unlike a reservation's half-open
// [check_in, check_out)): a block from 2026-05-03 to 2026-05-03 is one full
// blocked day. `days` is computed inclusively to match.

const SOURCE_ENUM = z.enum(['hostaway', 'manual']);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const inputSchema = z
  .object({
    property_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Restrict to a single property. Use find_properties to resolve a name to an id first. For blocks across several specific properties in one call, use property_ids instead.",
      ),
    property_ids: z
      .array(z.string().uuid())
      .min(1)
      .optional()
      .describe(
        "Batch property filter. Returns blocks whose property_id matches ANY of the supplied ids — OR semantics. Resolve each name with find_properties first. Mutually exclusive with property_id. Combines freely with date filters; prefer one batched call over looping property_id one id at a time.",
      ),
    ids: z
      .array(z.string().uuid())
      .optional()
      .describe('Batch lookup by calendar_block UUID. Other filters are ignored when set.'),
    overlapping: z
      .object({
        from: dateString.optional(),
        to: dateString.optional(),
      })
      .optional()
      .describe(
        'Match blocks whose [start_date, end_date] range overlaps this window. Either bound is optional. Both block dates are inclusive.',
      ),
    current_only: z
      .boolean()
      .optional()
      .describe(
        'When true, only blocks that cover reference_date (start_date <= ref <= end_date). Mutually exclusive with upcoming/past and with overlapping.',
      ),
    upcoming: z
      .boolean()
      .optional()
      .describe(
        'When true, only blocks whose start_date is after reference_date. Mutually exclusive with current_only/past and with overlapping.',
      ),
    past: z
      .boolean()
      .optional()
      .describe(
        'When true, only blocks whose end_date is before reference_date. Mutually exclusive with current_only/upcoming and with overlapping.',
      ),
    reference_date: dateString
      .optional()
      .describe(
        "Today's date in the user's timezone (YYYY-MM-DD). Used by current_only/upcoming/past so 'today' matches the user's local clock instead of server UTC. Defaults to today UTC when omitted.",
      ),
    source: SOURCE_ENUM
      .optional()
      .describe(
        "'hostaway' → blocks synced from the Hostaway listing calendar. 'manual' → blocks created directly in Foreshadow. Omit to return both.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max rows to return. Default 25, hard cap 100.'),
    sort: z
      .enum(['most_recent', 'earliest'])
      .optional()
      .describe(
        "Result ordering. 'most_recent' = latest blocks first (by start_date desc); 'earliest' = soonest blocks first (by start_date asc). Default: 'most_recent' when past=true, otherwise 'earliest'. Resolved order echoed in meta.sort.",
      ),
  })
  .refine(
    (v) => {
      const flags = [v.current_only, v.upcoming, v.past].filter(Boolean).length;
      return flags <= 1;
    },
    {
      message: 'current_only, upcoming, and past are mutually exclusive — pass at most one.',
      path: ['current_only'],
    },
  )
  .refine(
    (v) => {
      const usingBucket =
        v.current_only === true || v.upcoming === true || v.past === true;
      const usingExplicitRange = Boolean(v.overlapping?.from || v.overlapping?.to);
      return !(usingBucket && usingExplicitRange);
    },
    {
      message:
        'current_only/upcoming/past cannot be combined with overlapping. Use one or the other.',
      path: ['current_only'],
    },
  )
  .refine((v) => !(v.property_id && v.property_ids), {
    message: 'property_id and property_ids are mutually exclusive; pick one',
    path: ['property_ids'],
  });

type Input = z.infer<typeof inputSchema>;

export interface CalendarBlockRow {
  block_id: string;
  property_id: string | null;
  property_name: string | null;
  source: 'hostaway' | 'manual';
  start_date: string | null;
  end_date: string | null;
  /** Inclusive number of blocked days: end_date - start_date + 1. null if either date is missing. */
  days: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = 'id, property_id, source, start_date, end_date, note, created_at, updated_at';

const DEFAULT_LIMIT = 25;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** Inclusive day span between two YYYY-MM-DD dates (single-day block = 1). */
function diffDaysInclusive(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000)) + 1;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

interface ResolvedProperty {
  id: string;
  name: string;
}

async function fetchProperty(
  supabase: Supabase,
  propertyId: string,
): Promise<{ ok: true; row: ResolvedProperty | null } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  return { ok: true, row: (data as ResolvedProperty | null) ?? null };
}

async function handler(input: Input): Promise<ToolResult<CalendarBlockRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  // FK pre-validation — same rationale as find_reservations: a fabricated but
  // syntactically-valid UUID would otherwise return ok:true,data:[] and read as
  // "definitively no blocks." Turn it into a loud not_found instead. Skipped on
  // the `ids` batch path (invalid block ids there simply return fewer rows).
  let resolvedProperty: ResolvedProperty | null = null;
  if (!input.ids && input.property_id) {
    const r = await fetchProperty(supabase, input.property_id);
    if (!r.ok) {
      return { ok: false, error: { code: 'db_error', message: r.message } };
    }
    if (!r.row) {
      const err: ToolError = {
        code: 'not_found',
        message: `No row in properties with id ${input.property_id} (passed as property_id).`,
        hint: 'Call find_properties to resolve a property name into a valid id.',
      };
      return { ok: false, error: err };
    }
    resolvedProperty = r.row;
  }

  // Batch FK validation for property_ids — one round-trip; any UUID missing from
  // the result is fabricated and surfaces as a loud not_found.
  let resolvedProperties: ResolvedProperty[] | null = null;
  if (!input.ids && input.property_ids && input.property_ids.length > 0) {
    const unique = Array.from(new Set(input.property_ids));
    const { data: foundRows, error: propsErr } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', unique);
    if (propsErr) {
      return { ok: false, error: { code: 'db_error', message: propsErr.message } };
    }
    const found = (foundRows ?? []) as ResolvedProperty[];
    const foundIds = new Set(found.map((r) => r.id));
    const missing = unique.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `property_ids contains UUIDs not in properties: ${missing.join(', ')}`,
          hint: 'Call find_properties to resolve names to valid property_ids before passing them here.',
        },
      };
    }
    resolvedProperties = found;
  }

  // Ordering by intent — mirror find_reservations: past → newest-first,
  // everything else → soonest-first; caller can override with `sort`. Resolved
  // order is echoed in meta.sort. Pull limit+1 to detect truncation cheaply.
  const sort: 'most_recent' | 'earliest' =
    input.sort ?? (input.past === true ? 'most_recent' : 'earliest');

  let q = supabase.from('calendar_blocks').select(SELECT);
  if (sort === 'most_recent') {
    q = q
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('end_date', { ascending: false, nullsFirst: false });
  } else {
    q = q
      .order('start_date', { ascending: true, nullsFirst: false })
      .order('end_date', { ascending: true, nullsFirst: false });
  }
  q = q.order('created_at', { ascending: false }).limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    q = q.in('id', input.ids);
  } else {
    if (resolvedProperty) {
      q = q.eq('property_id', resolvedProperty.id);
    } else if (resolvedProperties) {
      q = q.in(
        'property_id',
        resolvedProperties.map((p) => p.id),
      );
    }

    if (input.source) {
      q = q.eq('source', input.source);
    }

    // Convenience time buckets. The refines guarantee at most one is active and
    // that they never combine with `overlapping`. Both block dates are inclusive.
    const ref = input.reference_date ?? todayUtcDate();
    if (input.current_only === true) {
      q = q.lte('start_date', ref).gte('end_date', ref);
    } else if (input.upcoming === true) {
      q = q.gt('start_date', ref);
    } else if (input.past === true) {
      q = q.lt('end_date', ref);
    } else if (input.overlapping) {
      if (input.overlapping.to) {
        q = q.lte('start_date', input.overlapping.to);
      }
      if (input.overlapping.from) {
        q = q.gte('end_date', input.overlapping.from);
      }
    }
  }

  const { data, error } = await q;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  // Resolve property_name for every block in the result. calendar_blocks has no
  // denormalized name column (unlike reservations), so we map property_id →
  // properties.name in one round-trip. We use the canonical properties.name here
  // (operator-facing); the multi-property Timeline feed resolves to the drifted
  // reservation name for row-keying reasons, but that quirk doesn't belong in an
  // operator Q&A tool.
  const nameById = new Map<string, string>();
  if (resolvedProperty) nameById.set(resolvedProperty.id, resolvedProperty.name);
  if (resolvedProperties) {
    for (const p of resolvedProperties) nameById.set(p.id, p.name);
  }
  const unresolvedIds = Array.from(
    new Set(
      trimmed
        .map((r) => r.property_id as string | null)
        .filter((id): id is string => Boolean(id) && !nameById.has(id as string)),
    ),
  );
  if (unresolvedIds.length > 0) {
    const { data: nameRows, error: nameErr } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', unresolvedIds);
    if (nameErr) {
      return { ok: false, error: { code: 'db_error', message: nameErr.message } };
    }
    for (const p of (nameRows ?? []) as ResolvedProperty[]) {
      nameById.set(p.id, p.name);
    }
  }

  const transformed: CalendarBlockRow[] = trimmed.map((r) => {
    const startDate = toDateOnly(r.start_date as string | null | undefined);
    const endDate = toDateOnly(r.end_date as string | null | undefined);
    const propertyId = (r.property_id as string | null) ?? null;
    return {
      block_id: r.id as string,
      property_id: propertyId,
      property_name: propertyId ? nameById.get(propertyId) ?? null : null,
      source: (r.source as 'hostaway' | 'manual' | null) ?? 'hostaway',
      start_date: startDate,
      end_date: endDate,
      days: diffDaysInclusive(startDate, endDate),
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    };
  });

  const meta: ToolMeta = {
    returned: transformed.length,
    limit,
    truncated,
    sort:
      sort === 'most_recent'
        ? 'most_recent (latest start_date first)'
        : 'earliest (soonest start_date first)',
    ...(resolvedProperty
      ? {
          resolved_property: {
            property_id: resolvedProperty.id,
            name: resolvedProperty.name,
          },
        }
      : {}),
    ...(resolvedProperties
      ? {
          resolved_properties: resolvedProperties.map((p) => ({
            property_id: p.id,
            name: p.name,
          })),
        }
      : {}),
  };

  return { ok: true, data: transformed, meta };
}

export const findCalendarBlocks: ToolDefinition<Input, CalendarBlockRow[]> = {
  name: 'find_calendar_blocks',
  description:
    "Find calendar BLOCKS — manual/maintenance days a property is marked unavailable WITHOUT a reservation (e.g. a maintenance hold or deep-clean close-down). These are NOT bookings: no guest, no revenue, and they fire no automations. CRITICAL boundary: guest bookings AND owner stays are reservations, not blocks — for 'is the owner staying' or any guest stay use find_reservations (with kind='owner_stay' for owner-reserved dates); this tool only returns the separate maintenance/manual blocks. Filter by property_id (one) or property_ids (several; resolve names with find_properties first). Use overlapping {from,to} for a date window, or the convenience flags current_only/upcoming/past with reference_date in the user's timezone. Both start_date and end_date are INCLUSIVE; each row includes a computed `days` (inclusive blocked-day count) and the resolved property_name. `source` is 'hostaway' (synced from the listing calendar) or 'manual' (created in Foreshadow). ORDERING: `sort` is 'most_recent' (latest start_date first) or 'earliest' (soonest first); defaults to 'most_recent' when past=true, else 'earliest'. Resolved order is in meta.sort.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Property UUID for single-property questions. Resolve property names with find_properties before calling. For blocks across several properties, use property_ids instead.',
      },
      property_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description:
          'Batch property filter. Returns blocks whose property_id matches ANY of the supplied ids — OR semantics. Resolve each name with find_properties first. Mutually exclusive with property_id.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by calendar_block UUID. When provided, other filters are ignored.',
      },
      overlapping: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive upper bound.' },
        },
        additionalProperties: false,
        description:
          'Match blocks whose [start_date, end_date] range overlaps this window. Both block dates are inclusive.',
      },
      current_only: {
        type: 'boolean',
        description:
          'When true, only blocks covering reference_date (start_date <= ref <= end_date). Mutually exclusive with upcoming/past and with overlapping.',
      },
      upcoming: {
        type: 'boolean',
        description:
          'When true, only blocks whose start_date is after reference_date. Mutually exclusive with current_only/past and with overlapping.',
      },
      past: {
        type: 'boolean',
        description:
          'When true, only blocks whose end_date is before reference_date. Mutually exclusive with current_only/upcoming and with overlapping.',
      },
      reference_date: {
        type: 'string',
        description:
          "Today's date in the user's timezone, formatted YYYY-MM-DD. Used by current_only/upcoming/past so 'today' matches the user's local clock rather than server UTC. Defaults to today UTC.",
      },
      source: {
        type: 'string',
        enum: ['hostaway', 'manual'],
        description:
          "'hostaway' → blocks synced from the Hostaway listing calendar. 'manual' → blocks created directly in Foreshadow. Omit to return both.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Max rows to return. Default 25.',
      },
      sort: {
        type: 'string',
        enum: ['most_recent', 'earliest'],
        description:
          "Result ordering. 'most_recent' = latest blocks first (by start_date); 'earliest' = soonest first. Default: 'most_recent' when past=true, otherwise 'earliest'. Resolved order is returned in meta.sort.",
      },
    },
    additionalProperties: false,
  },
  handler,
};
