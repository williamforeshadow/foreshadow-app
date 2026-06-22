import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  computeAvailability,
  isStayAvailable,
  type AvailableWindow,
} from '@/src/server/availability/computeAvailability';
import type { ToolDefinition, ToolResult, ToolContext } from './types';

// check_property_availability — the Concierge's availability lens for THIS
// property. It answers WHETHER dates are free, never WHY: the underlying module
// merges reservations (guest AND owner, undifferentiated) with maintenance
// blocks into an opaque busy/free signal. The Concierge literally cannot tell a
// guest "the owner is arriving" or "it's blocked for maintenance" — that detail
// never reaches it.
//
// Property is bound through ToolContext (ctx.draft.propertyId), exactly like
// get_property_knowledge_for_guest — the guest-facing model can never point this
// at another property's calendar. (Cross-property "what else is free" is a
// separate, future tool with its own security posture.)
//
// Freshness: the module refreshes this one property from the PMS before
// answering (gated to ~2 min), so a just-made booking is reflected even between
// the scheduled portfolio syncs.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const inputSchema = z
  .object({
    check_in: dateString
      .optional()
      .describe('Requested arrival date (YYYY-MM-DD). Pair with check_out to ask "is this exact stay open?".'),
    check_out: dateString
      .optional()
      .describe('Requested departure date (YYYY-MM-DD). The checkout day itself does NOT need to be free (turnover).'),
    from: dateString
      .optional()
      .describe('Window start (YYYY-MM-DD) for scanning availability across a range. Pair with `to`.'),
    to: dateString
      .optional()
      .describe('Window end (YYYY-MM-DD), inclusive. Pair with `from`.'),
  })
  .refine(
    (v) => {
      const stay = Boolean(v.check_in && v.check_out);
      const window = Boolean(v.from && v.to);
      return (stay || window) && !(stay && window);
    },
    {
      message:
        'Provide EITHER check_in+check_out (a specific requested stay) OR from+to (a window to scan) — not both, not neither.',
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

export interface AvailabilityToolResult {
  /** 'stay' = a specific requested stay was checked; 'window' = a date range was scanned. */
  mode: 'stay' | 'window';
  /** Echoes what was asked. For 'stay', from/to are the occupied-NIGHT window. */
  window: { from: string; to: string };
  /** Overall bookable: nothing occupied AND the stay length meets the night rules. */
  available: boolean;
  /**
   * Window mode only: bookable openings as ready-to-quote check_in→check_out
   * ranges (turnover-correct, already filtered to the min-night rule). Quote
   * these verbatim — never compute openings yourself. Empty in stay mode.
   */
  available_windows: AvailableWindow[];
  /** Whole nights the request implies (for evaluating the night rules). */
  requested_nights: number;
  /** The property's minimum-night rule, if any. A shorter stay is not bookable. */
  min_nights: number | null;
  /** The property's maximum-night rule, if any. */
  max_nights: number | null;
  /** False when the requested length violates min/max nights (even if the calendar is open). */
  meets_stay_rules: boolean;
  /** True when the property's data was just refreshed live from the PMS. */
  fresh: boolean;
}

/** Whole nights implied by the request — exact for a stay, the span for a window. */
function requestedNights(input: Input): number {
  const a = (input.check_in ?? input.from!).slice(0, 10);
  const b = (input.check_out ?? input.to!).slice(0, 10);
  const diff = Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
  return Math.max(1, diff);
}

async function handler(input: Input, ctx: ToolContext): Promise<ToolResult<AvailabilityToolResult>> {
  // Context binding only — never trust a model-supplied property id here.
  const propertyId = ctx.draft?.propertyId ?? null;
  if (!propertyId) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'No property is bound to this draft.' },
    };
  }

  try {
    // The property's night rules — a too-short stay isn't bookable even with an
    // open calendar (this is what made earlier answers wrong).
    const { data: propRow } = await getSupabaseServer()
      .from('properties')
      .select('min_nights, max_nights')
      .eq('id', propertyId)
      .maybeSingle();
    const minNights = (propRow?.min_nights as number | null) ?? null;
    const maxNights = (propRow?.max_nights as number | null) ?? null;

    const nights = requestedNights(input);
    const meetsRules =
      (minNights == null || nights >= minNights) && (maxNights == null || nights <= maxNights);

    if (input.check_in && input.check_out) {
      const { available, fresh } = await isStayAvailable(
        propertyId,
        input.check_in,
        input.check_out,
      );
      return {
        ok: true,
        data: {
          mode: 'stay',
          window: { from: input.check_in, to: input.check_out },
          available: available && meetsRules,
          available_windows: [],
          requested_nights: nights,
          min_nights: minNights,
          max_nights: maxNights,
          meets_stay_rules: meetsRules,
          fresh,
        },
      };
    }

    const result = await computeAvailability(propertyId, {
      from: input.from!,
      to: input.to!,
    });
    // Only openings long enough to satisfy the minimum-night rule are real
    // options. (Max isn't a filter — a long opening is still bookable for up to
    // max nights; the guest picks within it.)
    const availableWindows = result.free.filter(
      (w) => minNights == null || w.nights >= minNights,
    );
    return {
      ok: true,
      data: {
        mode: 'window',
        window: result.window,
        available: result.fully_available,
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

export const checkPropertyAvailability: ToolDefinition<Input, AvailabilityToolResult> = {
  name: 'check_property_availability',
  description:
    "Check whether THIS property is bookable for given dates. Call it with no property argument (the property is known from the conversation). Two modes: (1) SPECIFIC STAY — pass check_in + check_out; `available` is true ONLY when the calendar is open AND the length satisfies the property's min/max-night rule. If `available` is false, check meets_stay_rules — when that's false the calendar may be open but the stay length breaks the min/max-night rule (e.g. a one-week request at a 31-night-minimum place is NOT bookable; see min_nights / requested_nights). (2) FLEXIBLE WINDOW — pass from + to (e.g. all of July); read `available_windows`: a list of bookable openings as exact check_in→check_out ranges, already turnover-correct and already filtered to the minimum-night rule. QUOTE available_windows VERBATIM — do NOT compute or adjust the openings yourself. An opening with open_ended=true runs to the edge of the searched range, not a real next booking — present it as 'from check_in onward', not a fixed checkout. If available_windows is empty, there are no bookable openings of sufficient length in that range. The night minimum is a normal booking rule you MAY share with the guest. But for date conflicts, never reveal WHO is staying or WHY a date is taken — owner stay, guest booking, and maintenance block are all just 'unavailable'. Reflects bookings made since the last sync (it refreshes live).",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      check_in: {
        type: 'string',
        description: 'Requested arrival date YYYY-MM-DD. Pair with check_out to check one specific stay.',
      },
      check_out: {
        type: 'string',
        description: 'Requested departure date YYYY-MM-DD. The checkout day itself need not be free (turnover).',
      },
      from: {
        type: 'string',
        description: 'Window start YYYY-MM-DD for scanning a range. Pair with `to`.',
      },
      to: {
        type: 'string',
        description: 'Window end YYYY-MM-DD, inclusive. Pair with `from`.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
