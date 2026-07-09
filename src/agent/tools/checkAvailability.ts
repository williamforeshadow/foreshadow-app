import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  computeAvailability,
  isStayAvailable,
  type BusySpan,
  type AvailableWindow,
} from '@/src/server/availability/computeAvailability';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolError, type ToolResult } from './types';

// check_availability — the OPERATOR-facing availability tool.
//
// The ops agent must NOT answer "which days is X free?" by eyeballing
// find_reservations: deriving open gaps by hand fumbles the turnover boundary
// (a checkout day is bookable), the minimum-night rule, and the night count.
// This tool runs the SAME deterministic computeAvailability engine the
// Concierge uses, so the operator gets the correct, ready-to-quote windows.
//
// Unlike the Concierge's check_property_availability (bound to one conversation
// property and opaque), this takes an explicit property_id and is operator-
// facing — it still merges reservations ∪ blocks, but the operator can pair it
// with find_reservations / find_calendar_blocks to see WHO/WHY behind a date.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const inputSchema = z
  .object({
    property_id: z
      .string()
      .uuid()
      .describe('Property UUID. Resolve a name to an id with find_properties first.'),
    check_in: dateString
      .optional()
      .describe('Requested arrival date (YYYY-MM-DD). Pair with check_out to test one specific stay.'),
    check_out: dateString
      .optional()
      .describe('Requested departure date (YYYY-MM-DD). The checkout day need not be free (turnover).'),
    from: dateString
      .optional()
      .describe('Window start (YYYY-MM-DD) to list openings across a range. Pair with `to`.'),
    to: dateString.optional().describe('Window end (YYYY-MM-DD), inclusive. Pair with `from`.'),
  })
  .refine(
    (v) => {
      const stay = Boolean(v.check_in && v.check_out);
      const window = Boolean(v.from && v.to);
      return (stay || window) && !(stay && window);
    },
    {
      message:
        'Provide EITHER check_in+check_out (a specific stay) OR from+to (a window to scan) — not both, not neither.',
      path: ['check_in'],
    },
  )
  .refine((v) => !(v.check_in && v.check_out) || v.check_out > v.check_in, {
    message: 'check_out must be after check_in.',
    path: ['check_out'],
  })
  .refine((v) => !(v.from && v.to) || v.to >= v.from, {
    message: 'to must be on or after from.',
    path: ['to'],
  });

type Input = z.infer<typeof inputSchema>;

export interface OpsAvailabilityResult {
  property_id: string;
  property_name: string | null;
  /** 'stay' = a specific requested stay; 'window' = a date range scanned. */
  mode: 'stay' | 'window';
  window: { from: string; to: string };
  /** Bookable: nothing occupied AND the stay length meets the min/max-night rule. */
  available: boolean;
  /** Occupied date spans within scope (dates only — use find_reservations for who/why). */
  busy: BusySpan[];
  /** Window mode: bookable openings as exact check_in→check_out ranges (turnover-correct, min-night filtered). Empty in stay mode. */
  available_windows: AvailableWindow[];
  requested_nights: number;
  min_nights: number | null;
  max_nights: number | null;
  /** False when the requested length violates min/max nights even with an open calendar. */
  meets_stay_rules: boolean;
  /** True when the property's data was just refreshed live from the PMS. */
  fresh: boolean;
}

/** Whole nights implied by the request — exact for a stay, the span for a window. */
function requestedNights(input: Input): number {
  const a = (input.check_in ?? input.from!).slice(0, 10);
  const b = (input.check_out ?? input.to!).slice(0, 10);
  const diff = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return Math.max(1, diff);
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<OpsAvailabilityResult>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const supabase = getSupabaseServer();

  // FK pre-validation — a fabricated-but-valid UUID (or a cross-org property)
  // would otherwise read as "definitively no availability." Scope to the org
  // and surface a loud not_found instead.
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id, name, min_nights, max_nights')
    .eq('id', input.property_id)
    .eq('org_id', org)
    .maybeSingle();
  if (propErr) {
    return { ok: false, error: { code: 'db_error', message: propErr.message } };
  }
  if (!prop) {
    const err: ToolError = {
      code: 'not_found',
      message: `No row in properties with id ${input.property_id}.`,
      hint: 'Call find_properties to resolve a property name into a valid id.',
    };
    return { ok: false, error: err };
  }
  const minNights = (prop.min_nights as number | null) ?? null;
  const maxNights = (prop.max_nights as number | null) ?? null;
  const propertyName = (prop.name as string | null) ?? null;

  const nights = requestedNights(input);
  const meetsRules =
    (minNights == null || nights >= minNights) && (maxNights == null || nights <= maxNights);

  try {
    if (input.check_in && input.check_out) {
      const { available, conflicts, fresh } = await isStayAvailable(
        input.property_id,
        input.check_in,
        input.check_out,
        {},
        supabase,
      );
      return {
        ok: true,
        data: {
          property_id: input.property_id,
          property_name: propertyName,
          mode: 'stay',
          window: { from: input.check_in, to: input.check_out },
          available: available && meetsRules,
          busy: conflicts,
          available_windows: [],
          requested_nights: nights,
          min_nights: minNights,
          max_nights: maxNights,
          meets_stay_rules: meetsRules,
          fresh,
        },
      };
    }

    const result = await computeAvailability(
      input.property_id,
      { from: input.from!, to: input.to! },
      {},
      supabase,
    );
    const availableWindows = result.free.filter((w) => minNights == null || w.nights >= minNights);
    return {
      ok: true,
      data: {
        property_id: input.property_id,
        property_name: propertyName,
        mode: 'window',
        window: result.window,
        available: result.fully_available,
        busy: result.busy,
        available_windows: availableWindows,
        requested_nights: nights,
        min_nights: minNights,
        max_nights: maxNights,
        meets_stay_rules: meetsRules,
        fresh: result.fresh,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check availability';
    return { ok: false, error: { code: 'db_error', message } };
  }
}

export const checkAvailability: ToolDefinition<Input, OpsAvailabilityResult> = {
  name: 'check_availability',
  description:
    "Determine which dates a property is bookable — USE THIS for any 'when is X free / available?', 'can I book Jul 5–8?', or 'what's open in July?' question. Do NOT answer availability by reading find_reservations and working out the gaps yourself: that mis-handles the turnover day (a checkout day is bookable by the next guest), the minimum-night rule, and the night count. This runs the deterministic availability engine (reservations ∪ maintenance blocks, owner stays included as occupied) so the windows are correct. Resolve the property name to an id with find_properties first. Two modes: (1) SPECIFIC STAY — check_in + check_out → `available` is true only if the calendar is open AND the length fits the property's min/max-night rule (see meets_stay_rules / min_nights). (2) WINDOW — from + to (e.g. all of July) → `available_windows`: the bookable openings as exact check_in→check_out ranges, already turnover-correct and min-night filtered; present check_out as the DEPARTURE date (do not subtract a day). An opening with open_ended=true reaches the edge of the searched range rather than a real next booking — it's free from check_in onward (possibly longer), so don't present its check_out as a hard end. `busy` lists occupied date spans (dates only — pair with find_reservations for who's staying). Refreshes live from the PMS.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description: 'Property UUID. Resolve a name with find_properties first.',
      },
      check_in: {
        type: 'string',
        description: 'Requested arrival date YYYY-MM-DD. Pair with check_out for one specific stay.',
      },
      check_out: {
        type: 'string',
        description: 'Requested departure date YYYY-MM-DD. The checkout day need not be free (turnover).',
      },
      from: { type: 'string', description: 'Window start YYYY-MM-DD for scanning a range. Pair with `to`.' },
      to: { type: 'string', description: 'Window end YYYY-MM-DD, inclusive. Pair with `from`.' },
    },
    required: ['property_id'],
    additionalProperties: false,
  },
  handler,
};
