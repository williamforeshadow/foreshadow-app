import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  computeAvailability,
  type AvailabilityWindow,
  type AvailableWindow,
} from '@/src/server/availability/computeAvailability';
import type { ToolDefinition, ToolResult, ToolMeta, ToolContext } from './types';

// find_available_properties — cross-portfolio availability recommender with
// channel-matched listing links.
//
// Phase-2 companion to check_property_availability. Where that tool answers "is
// THIS property free?", this answers "what ELSE is free for these dates — and
// give me a link the guest can actually book?" so the Concierge can offer real
// alternatives when the guest's own property is taken.
//
// Three constraints define it:
//   1. CHANNEL-MATCHED LINKS. The guest is on one OTA (ctx.draft.channel). We
//      only recommend properties that have a listing URL on THAT channel, and
//      return that URL. Never cross-channel — sending an Airbnb guest a Vrbo or
//      direct link is both confusing and an OTA off-platform-steering-policy
//      risk. A property with no listing on the guest's channel is silently
//      excluded (can't be linked → can't be offered).
//   2. SIMILARITY-RANKED. Prefer the same city, then the closest bed/bath count
//      to the guest's own property, so the suggestions actually resemble what
//      they wanted.
//   3. OPAQUE + FRESH. Reuses computeAvailability (no guest/owner/block reasons
//      leak) with the cost-bounded scan-native-then-confirm-shortlist freshness.
//
// Not bound to one property (it intentionally reveals others exist) but EXCLUDES
// the conversation's own property via ctx.draft.propertyId.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const inputSchema = z
  .object({
    check_in: dateString
      .optional()
      .describe('Requested arrival date (YYYY-MM-DD). Pair with check_out to find properties open for that exact stay.'),
    check_out: dateString
      .optional()
      .describe('Requested departure date (YYYY-MM-DD). The checkout day itself need not be free (turnover).'),
    from: dateString
      .optional()
      .describe('Window start (YYYY-MM-DD) to find properties free across a range. Pair with `to`.'),
    to: dateString.optional().describe('Window end (YYYY-MM-DD), inclusive. Pair with `from`.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Max properties to recommend. Default 3, hard cap 10. Keep it small — a couple of good options beats a long list.'),
  })
  .refine(
    (v) => {
      const stay = Boolean(v.check_in && v.check_out);
      const window = Boolean(v.from && v.to);
      return (stay || window) && !(stay && window);
    },
    {
      message:
        'Provide EITHER check_in+check_out (a specific requested stay) OR from+to (a window) — not both, not neither.',
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

export interface AvailablePropertyRec {
  /** The guest's channel this listing is on (matches the conversation). */
  channel: string;
  /** Public listing URL on that channel — link the guest here. */
  url: string;
  /** Friendly anchor text if the operator set one; null → describe by city/beds and use a channel label. */
  display_title: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /**
   * Window mode only: this property's bookable openings within the requested
   * range, as exact check_in→check_out ranges (turnover-correct, min-night
   * filtered). Quote these for "what dates is that available?". Empty in stay
   * mode (the requested stay itself is the answer).
   */
  available_windows: AvailableWindow[];
}

const DEFAULT_LIMIT = 3;

function toDateOnly(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** Effective inclusive date window to test for availability, from either mode. */
function effectiveWindow(input: Input): AvailabilityWindow {
  if (input.check_in && input.check_out) {
    const ci = toDateOnly(input.check_in);
    const coMs = Date.parse(`${toDateOnly(input.check_out)}T00:00:00Z`) - 86_400_000;
    const lastNight = new Date(coMs).toISOString().slice(0, 10);
    return { from: ci, to: lastNight < ci ? ci : lastNight };
  }
  return { from: toDateOnly(input.from!), to: toDateOnly(input.to!) };
}

interface PropRow {
  id: string;
  address_city: string | null;
  address_state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  min_nights: number | null;
  max_nights: number | null;
}

/** Whole nights implied by the request — exact for a stay, the span for a window. */
function requestedNights(input: Input): number {
  const a = input.check_in ?? input.from!;
  const b = input.check_out ?? input.to!;
  const diff = Math.round(
    (Date.parse(`${toDateOnly(b)}T00:00:00Z`) - Date.parse(`${toDateOnly(a)}T00:00:00Z`)) /
      86_400_000,
  );
  return Math.max(1, diff);
}

/** A stay of `nights` satisfies the property's min/max-night booking rule. */
function meetsNightRule(p: PropRow, nights: number): boolean {
  if (p.min_nights != null && nights < p.min_nights) return false;
  if (p.max_nights != null && nights > p.max_nights) return false;
  return true;
}

interface ListingRow {
  property_id: string;
  url: string;
  display_title: string | null;
}

/** Lower = more similar to the source property. Same city is a strong boost; then closest bed/bath. */
function similarityScore(source: PropRow | null, cand: PropRow): number {
  let score = 0;
  if (
    source?.address_city &&
    cand.address_city &&
    source.address_city.toLowerCase() === cand.address_city.toLowerCase()
  ) {
    score -= 100;
  }
  // Unknown counts are penalized as "dissimilar" so populated, close matches win.
  const bedDiff =
    source?.bedrooms != null && cand.bedrooms != null ? Math.abs(source.bedrooms - cand.bedrooms) : 5;
  const bathDiff =
    source?.bathrooms != null && cand.bathrooms != null
      ? Math.abs(source.bathrooms - cand.bathrooms)
      : 5;
  return score + bedDiff * 2 + bathDiff;
}

async function handler(input: Input, ctx: ToolContext): Promise<ToolResult<AvailablePropertyRec[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();
  const window = effectiveWindow(input);
  const excludePropertyId = ctx.draft?.propertyId ?? null;
  const channel = ctx.draft?.channel ?? null;

  // No channel → we can't produce a safe same-channel link, so there's nothing
  // we can responsibly recommend. Return empty rather than guess.
  if (!channel) {
    return {
      ok: true,
      data: [],
      meta: { returned: 0, limit, truncated: false, reason: 'no_channel' },
    };
  }

  // Source property (for similarity), plus all active candidates.
  const [srcRes, candRes] = await Promise.all([
    excludePropertyId
      ? supabase
          .from('properties')
          .select('id, address_city, address_state, bedrooms, bathrooms, min_nights, max_nights')
          .eq('id', excludePropertyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('properties')
      .select('id, address_city, address_state, bedrooms, bathrooms, min_nights, max_nights')
      .eq('is_active', true),
  ]);
  if (candRes.error) {
    return { ok: false, error: { code: 'db_error', message: candRes.error.message } };
  }
  const source = (srcRes.data as PropRow | null) ?? null;

  // Mode determines how we judge "available":
  //  - STAY ("can I book Jul 5–8?"): the property must be free for that exact
  //    stay AND the stay length must satisfy the property's min/max-night rule.
  //  - WINDOW ("what's open in July?"): the property is offerable if it has ANY
  //    bookable opening of at least its minimum nights; we return those openings.
  const isStayMode = Boolean(input.check_in && input.check_out);
  const stayNights = isStayMode ? requestedNights(input) : null;

  // Exclude the guest's own property. In stay mode, also drop properties whose
  // night rule the exact stay can't satisfy (e.g. a 31-night-minimum place for a
  // one-week request). In window mode the night rule is applied per-opening
  // instead, so we don't pre-filter on it here.
  const candidates = ((candRes.data ?? []) as PropRow[]).filter(
    (p) =>
      p.id !== excludePropertyId && (!isStayMode || meetsNightRule(p, stayNights!)),
  );
  if (candidates.length === 0) {
    return { ok: true, data: [], meta: { returned: 0, limit, truncated: false } };
  }

  // Channel filter: only properties with a listing on the GUEST'S channel are
  // linkable, hence offerable. One query → property_id → listing.
  const { data: listingData, error: listingErr } = await supabase
    .from('property_listings')
    .select('property_id, url, display_title')
    .eq('channel', channel)
    .in(
      'property_id',
      candidates.map((c) => c.id),
    );
  if (listingErr) {
    return { ok: false, error: { code: 'db_error', message: listingErr.message } };
  }
  const listingByProp = new Map<string, ListingRow>();
  for (const l of (listingData ?? []) as ListingRow[]) {
    if (!listingByProp.has(l.property_id)) listingByProp.set(l.property_id, l);
  }

  // Linkable candidates, ranked by similarity (most similar first), then name-
  // stable via id for determinism.
  const linkable = candidates
    .filter((c) => listingByProp.has(c.id))
    .sort((a, b) => {
      const d = similarityScore(source, a) - similarityScore(source, b);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

  // Judge a computed-availability result for one property by mode. Window mode
  // also yields the property's bookable openings (min-night filtered).
  const evaluate = (
    r: Awaited<ReturnType<typeof computeAvailability>>,
    p: PropRow,
  ): { available: boolean; windows: AvailableWindow[] } => {
    if (isStayMode) return { available: r.fully_available, windows: [] };
    const windows = r.free.filter((w) => p.min_nights == null || w.nights >= p.min_nights);
    return { available: windows.length > 0, windows };
  };

  // Phase A — fast native scan (no live PMS calls) to find what LOOKS available,
  // preserving similarity order.
  const looksFree: PropRow[] = [];
  await Promise.all(
    linkable.map(async (p) => {
      try {
        const r = await computeAvailability(p.id, window, { skipRefresh: true }, supabase);
        if (evaluate(r, p).available) looksFree.push(p);
      } catch {
        /* one property's read failing shouldn't sink the search */
      }
    }),
  );
  // Promise.all races resolution order; re-sort to restore similarity ranking.
  looksFree.sort((a, b) => {
    const d = similarityScore(source, a) - similarityScore(source, b);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  // Phase B — live-confirm the most-similar shortlist until `limit` confirmed,
  // capped so mass-staleness can't balloon into dozens of PMS calls.
  const maxAttempts = Math.min(looksFree.length, limit + 3);
  const confirmed: AvailablePropertyRec[] = [];
  let attempts = 0;
  for (const p of looksFree) {
    if (confirmed.length >= limit || attempts >= maxAttempts) break;
    attempts += 1;
    let evald: { available: boolean; windows: AvailableWindow[] };
    try {
      const r = await computeAvailability(p.id, window, { skipRefresh: false }, supabase);
      evald = evaluate(r, p);
    } catch {
      // Live-confirm failed (rate limit/403) → fall back to keeping it, but we
      // have no fresh windows to quote.
      evald = { available: true, windows: [] };
    }
    if (evald.available) {
      const listing = listingByProp.get(p.id)!;
      confirmed.push({
        channel,
        url: listing.url,
        display_title: listing.display_title,
        city: p.address_city,
        state: p.address_state,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        available_windows: evald.windows,
      });
    }
  }

  const meta: ToolMeta = {
    returned: confirmed.length,
    limit,
    truncated: looksFree.length > confirmed.length,
    window,
    channel,
    linkable_candidates: linkable.length,
  };

  return { ok: true, data: confirmed, meta };
}

export const findAvailableProperties: ToolDefinition<Input, AvailablePropertyRec[]> = {
  name: 'find_available_properties',
  description:
    "Find OTHER properties in the portfolio that are available for given dates AND bookable on the guest's own channel — use it to offer alternatives when their property is taken or when they ask what else you have, INCLUDING when they then ask 'what dates is that one available?'. Two modes: pass check_in + check_out for a specific stay (returns properties free for exactly that stay), or pass from + to for a flexible window like all of July (returns properties that have ANY bookable opening in that range, each WITH its openings). It excludes the guest's current property, returns only properties listed on the guest's channel (each with a `url`), and ranks by similarity (same city, closest bed/bath). Each result has: channel, listing `url`, optional `display_title`, city/state/bedrooms/bathrooms, and — in window mode — `available_windows`, the property's bookable openings as exact check_in→check_out ranges (already turnover-correct and min-night filtered). When the guest asks what dates an alternative is open, QUOTE its available_windows verbatim — do not compute them yourself. ALWAYS present an option as a hyperlink to its `url`, never a bare name; use `display_title` as link text if set, else describe it (e.g. \"a 3-bedroom in San Diego\"). NEVER share a link for a different channel than the guest's. If it returns empty, nothing suitable is open on their channel — say so and offer to have the team follow up.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      check_in: {
        type: 'string',
        description: 'Requested arrival date YYYY-MM-DD. Pair with check_out for a specific stay.',
      },
      check_out: {
        type: 'string',
        description: 'Requested departure date YYYY-MM-DD. The checkout day itself need not be free (turnover).',
      },
      from: { type: 'string', description: 'Window start YYYY-MM-DD. Pair with `to`.' },
      to: { type: 'string', description: 'Window end YYYY-MM-DD, inclusive. Pair with `from`.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Max properties to recommend. Default 3.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
