import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolError, ToolMeta, ToolResult } from './types';

// find_reservations — discover/list guest stays.
//
// Reservations are the temporal anchor for almost every operational question:
// "who's at Beach House this week", "is anything overdue for tomorrow's
// arrival", "show me last weekend's check-outs". This tool slices the
// reservations table by property, guest name, hostaway id, date ranges, or
// convenience time-buckets relative to a reference date.
//
// Together with find_properties → find_reservations → find_tasks, the agent
// has a clean composition path for "what tasks does this guest's stay
// involve" type questions.
//
// JSON-heavy fields aren't an issue here — reservations are intentionally
// thin rows. We return everything useful plus two computed conveniences
// (`nights`, `is_back_to_back`) so the model doesn't have to do date math.

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
        'Restrict to a single property. Use find_properties to resolve a name to an id first.',
      ),
    guest_name: z
      .string()
      .min(2)
      .optional()
      .describe(
        'Case-insensitive substring match on guest_name. Minimum 2 characters.',
      ),
    hostaway_reservation_id: z
      .number()
      .int()
      .optional()
      .describe(
        'Exact match on the upstream Hostaway reservation id. Useful when the user pastes a Hostaway link or number.',
      ),
    ids: z
      .array(z.string().uuid())
      .optional()
      .describe('Batch lookup by reservation UUID. Other filters are ignored when set.'),
    stays_overlapping: z
      .object({
        from: dateString.optional(),
        to: dateString.optional(),
      })
      .optional()
      .describe(
        'Match reservations whose [check_in, check_out] range overlaps this window. Either bound is optional.',
      ),
    check_in_between: z
      .object({
        from: dateString.optional(),
        to: dateString.optional(),
      })
      .optional()
      .describe('Inclusive range on check_in. Either bound is optional.'),
    check_out_between: z
      .object({
        from: dateString.optional(),
        to: dateString.optional(),
      })
      .optional()
      .describe('Inclusive range on check_out. Either bound is optional.'),
    current_only: z
      .boolean()
      .optional()
      .describe(
        'When true, only stays where reference_date falls within [check_in, check_out]. Mutually exclusive with upcoming/past and with explicit date-range filters.',
      ),
    upcoming: z
      .boolean()
      .optional()
      .describe(
        'When true, only stays whose check_in is after reference_date. Mutually exclusive with current_only/past and with explicit date-range filters.',
      ),
    past: z
      .boolean()
      .optional()
      .describe(
        'When true, only stays whose check_out is before reference_date. Mutually exclusive with current_only/upcoming and with explicit date-range filters.',
      ),
    reference_date: dateString
      .optional()
      .describe(
        "Today's date in the user's timezone (YYYY-MM-DD). Used by current_only/upcoming/past so 'today' matches the user's local clock instead of server UTC. Defaults to today UTC when omitted.",
      ),
    source: SOURCE_ENUM
      .optional()
      .describe(
        "'hostaway' → reservations synced from Hostaway. 'manual' → reservations created directly in Foreshadow. Maps to hostaway_reservation_id IS/IS NOT NULL.",
      ),
    has_next_check_in: z
      .boolean()
      .optional()
      .describe(
        'true → only stays with a known next_check_in (i.e. a follow-up reservation has been recorded). false → stays whose follow-up window is open-ended.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max rows to return. Default 25, hard cap 100.'),
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
      const usingExplicitRange =
        Boolean(v.stays_overlapping?.from || v.stays_overlapping?.to) ||
        Boolean(v.check_in_between?.from || v.check_in_between?.to) ||
        Boolean(v.check_out_between?.from || v.check_out_between?.to);
      return !(usingBucket && usingExplicitRange);
    },
    {
      message:
        'current_only/upcoming/past cannot be combined with stays_overlapping, check_in_between, or check_out_between. Use one or the other.',
      path: ['current_only'],
    },
  );

type Input = z.infer<typeof inputSchema>;

export interface ReservationRow {
  reservation_id: string;
  property_id: string | null;
  property_name: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  next_check_in: string | null;
  /** Whole-day count between check_in and check_out. null if either date is missing. */
  nights: number | null;
  /** True when check_out and next_check_in fall on the same calendar day. */
  is_back_to_back: boolean;
  source: 'hostaway' | 'manual';
  hostaway_reservation_id: number | null;
  created_at: string;
  updated_at: string;
}

const SELECT =
  'id, property_id, property_name, guest_name, check_in, check_out, next_check_in, hostaway_reservation_id, created_at, updated_at';

const DEFAULT_LIMIT = 25;

// Same sanitizer used by find_properties / find_tasks. Strips characters that
// PostgREST's `or()` filter or ILIKE would interpret. Keep duplicated until
// we lift to a shared utils module.
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function diffNights(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
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

async function handler(input: Input): Promise<ToolResult<ReservationRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  // FK pre-validation. Same rationale as find_tasks: the model loves
  // fabricating syntactically-valid UUIDs that match no row, which would
  // otherwise return ok:true,data:[] and read as "definitively no results."
  // We turn that into a loud not_found instead. Skipped on the `ids` batch
  // path since invalid uuids in `ids` simply return fewer rows.
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

  // Pull `limit + 1` so we can detect truncation cheaply, same as the other
  // list tools.
  let q = supabase
    .from('reservations')
    .select(SELECT)
    .order('check_in', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    q = q.in('id', input.ids);
  } else {
    if (resolvedProperty) {
      q = q.eq('property_id', resolvedProperty.id);
    }

    if (input.guest_name) {
      const term = sanitizeSearchTerm(input.guest_name);
      if (term.length > 0) {
        q = q.ilike('guest_name', `%${term}%`);
      }
    }

    if (input.hostaway_reservation_id != null) {
      q = q.eq('hostaway_reservation_id', input.hostaway_reservation_id);
    }

    if (input.source === 'hostaway') {
      q = q.not('hostaway_reservation_id', 'is', null);
    } else if (input.source === 'manual') {
      q = q.is('hostaway_reservation_id', null);
    }

    if (input.has_next_check_in === true) {
      q = q.not('next_check_in', 'is', null);
    } else if (input.has_next_check_in === false) {
      q = q.is('next_check_in', null);
    }

    // Convenience time buckets. The refine above guarantees at most one is
    // active and that they don't combine with explicit ranges.
    const ref = input.reference_date ?? todayUtcDate();
    if (input.current_only === true) {
      q = q.lte('check_in', ref).gte('check_out', ref);
    } else if (input.upcoming === true) {
      q = q.gt('check_in', ref);
    } else if (input.past === true) {
      q = q.lt('check_out', ref);
    } else {
      // Explicit date ranges — only applied when no convenience bucket fired.
      if (input.stays_overlapping) {
        if (input.stays_overlapping.to) {
          q = q.lte('check_in', input.stays_overlapping.to);
        }
        if (input.stays_overlapping.from) {
          q = q.gte('check_out', input.stays_overlapping.from);
        }
      }
      if (input.check_in_between?.from) {
        q = q.gte('check_in', input.check_in_between.from);
      }
      if (input.check_in_between?.to) {
        q = q.lte('check_in', input.check_in_between.to);
      }
      if (input.check_out_between?.from) {
        q = q.gte('check_out', input.check_out_between.from);
      }
      if (input.check_out_between?.to) {
        q = q.lte('check_out', input.check_out_between.to);
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

  const transformed: ReservationRow[] = trimmed.map((r) => {
    const checkIn = toDateOnly(r.check_in as string | null | undefined);
    const checkOut = toDateOnly(r.check_out as string | null | undefined);
    const nextCheckIn = toDateOnly(r.next_check_in as string | null | undefined);
    const hostawayId = r.hostaway_reservation_id as number | null | undefined;
    return {
      reservation_id: r.id as string,
      property_id: (r.property_id as string | null) ?? null,
      property_name: (r.property_name as string | null) ?? null,
      guest_name: (r.guest_name as string | null) ?? null,
      check_in: checkIn,
      check_out: checkOut,
      next_check_in: nextCheckIn,
      nights: diffNights(checkIn, checkOut),
      is_back_to_back: Boolean(checkOut && nextCheckIn && checkOut === nextCheckIn),
      source: hostawayId != null ? 'hostaway' : 'manual',
      hostaway_reservation_id: hostawayId ?? null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    };
  });

  const meta: ToolMeta = {
    returned: transformed.length,
    limit,
    truncated,
    ...(resolvedProperty
      ? {
          resolved_property: {
            property_id: resolvedProperty.id,
            name: resolvedProperty.name,
          },
        }
      : {}),
  };

  return { ok: true, data: transformed, meta };
}

export const findReservations: ToolDefinition<Input, ReservationRow[]> = {
  name: 'find_reservations',
  description:
    "Find guest reservations (stays) by property, guest name, Hostaway id, or date range. Use convenience flags current_only/upcoming/past for relative-time questions ('who's there now', 'this week's arrivals'); pass reference_date in the user's local timezone so 'today' aligns with their clock. Use find_properties first if the user mentions a property by name. Returns slim rows sorted by check_in asc (nulls last), created_at desc, with computed nights and is_back_to_back fields. There is no status column — cancellations are deletions, so you cannot ask for cancelled stays.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Property UUID. Resolve property names with find_properties before calling.',
      },
      guest_name: {
        type: 'string',
        minLength: 2,
        description:
          'Case-insensitive substring match on guest_name. Minimum 2 characters.',
      },
      hostaway_reservation_id: {
        type: 'integer',
        description:
          'Exact match on the upstream Hostaway reservation id. Useful when the user pastes a Hostaway link or number.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by reservation UUID. When provided, other filters are ignored.',
      },
      stays_overlapping: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive upper bound.' },
        },
        additionalProperties: false,
        description:
          'Match reservations whose [check_in, check_out] range overlaps this window.',
      },
      check_in_between: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive upper bound.' },
        },
        additionalProperties: false,
        description: 'Inclusive range on check_in.',
      },
      check_out_between: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive upper bound.' },
        },
        additionalProperties: false,
        description: 'Inclusive range on check_out.',
      },
      current_only: {
        type: 'boolean',
        description:
          'When true, only stays where reference_date falls within [check_in, check_out]. Mutually exclusive with upcoming/past and with explicit date-range filters.',
      },
      upcoming: {
        type: 'boolean',
        description:
          'When true, only stays whose check_in is after reference_date. Mutually exclusive with current_only/past and with explicit date-range filters.',
      },
      past: {
        type: 'boolean',
        description:
          'When true, only stays whose check_out is before reference_date. Mutually exclusive with current_only/upcoming and with explicit date-range filters.',
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
          "'hostaway' → reservations synced from Hostaway (hostaway_reservation_id is set). 'manual' → reservations created directly in Foreshadow.",
      },
      has_next_check_in: {
        type: 'boolean',
        description:
          'true → only stays with a known next_check_in (a follow-up reservation has been recorded). false → stays whose follow-up window is open-ended.',
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
