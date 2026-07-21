/**
 * Hostaway API client — server-side only.
 *
 * Per-org (P3): every fetcher takes the integration's HostawayCreds so multiple
 * orgs' Hostaway accounts can coexist. Tokens are cached per account id.
 */
import type { HostawayCreds } from '@/lib/pmsIntegrations';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken(creds: HostawayCreds): Promise<string> {
  const cached = tokenCache.get(creds.accountId);
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.token;
  }

  const res = await fetch('https://api.hostaway.com/v1/accessTokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.accountId,
      client_secret: creds.clientSecret,
      scope: 'general',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[Hostaway] Auth failed:', res.status, body);
    throw new Error(`Hostaway auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const entry = {
    token: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  tokenCache.set(creds.accountId, entry);

  // Hostaway docs: wait 1s after token generation before making calls
  await new Promise((r) => setTimeout(r, 1000));
  return entry.token;
}

/** Fetch all listings → Map of listingId → property name */
export async function fetchListings(creds: HostawayCreds): Promise<Map<number, string>> {
  const token = await getToken(creds);
  const map = new Map<number, string>();
  let offset = 0;

  while (true) {
    const res = await fetch(
      `https://api.hostaway.com/v1/listings?limit=100&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Listings fetch failed (${res.status})`);

    const { result = [] } = await res.json();
    for (const l of result) map.set(l.id, l.name);
    if (result.length < 100) break;
    offset += 100;
  }

  return map;
}

/**
 * Per-listing detail used to backfill property attributes + OTA listing URLs.
 * `name` is Hostaway's listing label (often an operator address-code, not a
 * clean public title). The *ListingUrl fields are the public OTA pages.
 */
export interface ListingDetail {
  name: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Minimum / maximum nights per stay — the listing's booking rule. */
  minNights: number | null;
  maxNights: number | null;
  airbnbListingUrl: string | null;
  vrboListingUrl: string | null;
  googleVrListingUrl: string | null;
}

/**
 * Fetch all listings with the fields we backfill: location, bed/bath counts,
 * and the per-OTA public listing URLs. Same paginated endpoint as
 * fetchListings — this just keeps the whole object instead of only the name.
 */
export async function fetchListingsDetailed(creds: HostawayCreds): Promise<Map<number, ListingDetail>> {
  const token = await getToken(creds);
  const map = new Map<number, ListingDetail>();
  let offset = 0;

  while (true) {
    const res = await fetch(
      `https://api.hostaway.com/v1/listings?limit=100&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Listings fetch failed (${res.status})`);

    const { result = [] } = await res.json();
    for (const l of result) {
      map.set(l.id, {
        name: l.name ?? null,
        city: l.city ?? null,
        state: l.state ?? null,
        bedrooms: typeof l.bedroomsNumber === 'number' ? l.bedroomsNumber : null,
        bathrooms: typeof l.bathroomsNumber === 'number' ? l.bathroomsNumber : null,
        minNights: typeof l.minNights === 'number' ? l.minNights : null,
        maxNights: typeof l.maxNights === 'number' ? l.maxNights : null,
        airbnbListingUrl: l.airbnbListingUrl || null,
        vrboListingUrl: l.vrboListingUrl || null,
        googleVrListingUrl: l.googleVrListingUrl || null,
      });
    }
    if (result.length < 100) break;
    offset += 100;
  }

  return map;
}

/** Fetch current + future reservations (excluding cancelled/declined) */
export async function fetchReservations(creds: HostawayCreds, departureDateStart: string) {
  const token = await getToken(creds);
  const all: any[] = [];
  let offset = 0;
  // 'ownerstay' is included so owner-reserved dates flow into the app (tagged
  // kind='owner_stay' by the sync). Cancelled/declined statuses stay excluded.
  const allow = new Set(['new', 'confirmed', 'modified', 'ownerstay']);

  while (true) {
    const url = `https://api.hostaway.com/v1/reservations?departureDateStart=${departureDateStart}&limit=100&offset=${offset}&sortOrder=arrivalDateAsc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Reservations fetch failed (${res.status})`);

    const { result = [] } = await res.json();
    for (const r of result) {
      if (allow.has((r.status || '').toLowerCase()) && r.departureDate >= departureDateStart) {
        all.push(r);
      }
    }
    if (result.length < 100) break;
    offset += 100;
    await new Promise((r) => setTimeout(r, 700)); // rate-limit friendly
  }

  return all;
}

/**
 * Fetch current+future reservations for a SINGLE listing, for the on-demand
 * availability refresh (one property, not the whole portfolio). Same status
 * allowlist and date floor as fetchReservations, scoped server-side via the
 * listingId filter so it's one cheap call instead of paginating everything.
 * Returns the raw Hostaway reservation objects.
 */
export async function fetchReservationsForListing(
  creds: HostawayCreds,
  listingId: number,
  departureDateStart: string,
): Promise<any[]> {
  const token = await getToken(creds);
  const all: any[] = [];
  let offset = 0;
  const allow = new Set(['new', 'confirmed', 'modified', 'ownerstay']);

  while (true) {
    const url = `https://api.hostaway.com/v1/reservations?listingId=${listingId}&departureDateStart=${departureDateStart}&limit=100&offset=${offset}&sortOrder=arrivalDateAsc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Reservations fetch failed (${res.status}) for listing ${listingId}`);

    const { result = [] } = await res.json();
    for (const r of result) {
      if (allow.has((r.status || '').toLowerCase()) && r.departureDate >= departureDateStart) {
        all.push(r);
      }
    }
    if (result.length < 100) break;
    offset += 100;
    await new Promise((r) => setTimeout(r, 700));
  }

  return all;
}

/**
 * Fetch a listing's calendar for a date window. Each entry is one day with
 * `date` (YYYY-MM-DD), `status` ('available' | 'reserved' | 'blocked'),
 * `isAvailable` (0/1), `note`, and (with includeResources=1) a `reservations`
 * array. Used to surface manual/maintenance BLOCKS (status 'blocked', no
 * reservation) — reserved days are already covered by the reservation sync.
 */
export async function fetchListingCalendar(
  creds: HostawayCreds,
  listingId: number,
  startDate: string,
  endDate: string,
): Promise<Array<Record<string, any>>> {
  const token = await getToken(creds);
  const url = `https://api.hostaway.com/v1/listings/${listingId}/calendar?startDate=${startDate}&endDate=${endDate}&includeResources=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Calendar fetch failed (${res.status}) for listing ${listingId}`);
  }
  const { result = [] } = await res.json();
  return result as Array<Record<string, any>>;
}

/**
 * Fetch a single conversation object. Carries the guest's name
 * (`recipientName`) and `listingMapId` independent of any reservation — this is
 * how inquiry threads (no booked reservation) get a name + property.
 */
export async function fetchConversation(
  creds: HostawayCreds,
  conversationId: string | number,
): Promise<Record<string, unknown> | null> {
  const token = await getToken(creds);
  // includeResources=1 embeds the Reservation (status, channelName, dates) — the
  // conversation object alone doesn't carry those.
  const res = await fetch(
    `https://api.hostaway.com/v1/conversations/${conversationId}?includeResources=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Conversation fetch failed (${res.status})`);
  const { result = null } = await res.json();
  return result;
}

/**
 * List recent conversations (all types, including inquiries). Used by the
 * backfill/cron to discover threads that have no synced reservation and so never
 * surface via reservation sync. Returns raw conversation objects.
 */
export async function fetchConversationsList(
  creds: HostawayCreds,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const token = await getToken(creds);
  // includeResources=1 embeds each conversation's Reservation (status, channel,
  // dates) so the backfill can set booking_state/channel without a second call.
  const res = await fetch(
    `https://api.hostaway.com/v1/conversations?limit=${limit}&includeResources=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Conversations list fetch failed (${res.status})`);
  const { result = [] } = await res.json();
  return result;
}

/**
 * Fetch the full message history of a conversation — BOTH directions (guest +
 * host). The `message.received` webhook only delivers inbound guest messages, so
 * host replies must be pulled from here. Returns raw Hostaway message objects.
 */
export async function fetchConversationMessages(
  creds: HostawayCreds,
  conversationId: string | number,
): Promise<Record<string, unknown>[]> {
  const token = await getToken(creds);
  const all: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const url = `https://api.hostaway.com/v1/conversations/${conversationId}/messages?limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Conversation messages fetch failed (${res.status})`);
    }

    const { result = [] } = await res.json();
    all.push(...result);
    if (result.length < 100) break;
    offset += 100;
    await new Promise((r) => setTimeout(r, 700)); // rate-limit friendly
  }

  return all;
}

/**
 * Send a message into a Hostaway conversation.
 * `POST /v1/conversations/{id}/messages` with `{ body, communicationType }`.
 * communicationType is the gateway: 'channel' replies through the OTA
 * (Airbnb/VRBO/Booking), 'email' for direct/email guests (Hostaway's default).
 * Returns the created ConversationMessage object — its `id` becomes our
 * `hostaway_message_id`, `date` is a naive-UTC timestamp (normalize before store).
 */
export async function sendHostawayMessage(
  creds: HostawayCreds,
  conversationId: string | number,
  body: string,
  communicationType: 'channel' | 'email' = 'channel',
): Promise<Record<string, unknown>> {
  const token = await getToken(creds);
  const res = await fetch(
    `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-control': 'no-cache',
      },
      body: JSON.stringify({ body, communicationType }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hostaway send failed (${res.status}): ${text}`);
  }
  const { result } = await res.json();
  return (result ?? {}) as Record<string, unknown>;
}
