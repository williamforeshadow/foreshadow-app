/**
 * Hostaway API client — server-side only.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const accountId = process.env.HOSTAWAY_ACCOUNT_ID;
  const clientSecret = process.env.HOSTAWAY_CLIENT_SECRET;

  console.log('[Hostaway] Auth attempt — ACCOUNT_ID present:', !!accountId, '| SECRET present:', !!clientSecret);

  if (!accountId || !clientSecret) {
    throw new Error(
      `Missing Hostaway credentials: ACCOUNT_ID=${!!accountId}, SECRET=${!!clientSecret}`
    );
  }

  const res = await fetch('https://api.hostaway.com/v1/accessTokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: accountId,
      client_secret: clientSecret,
      scope: 'general',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[Hostaway] Auth failed:', res.status, body);
    throw new Error(`Hostaway auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  // Hostaway docs: wait 1s after token generation before making calls
  await new Promise((r) => setTimeout(r, 1000));
  return cachedToken.token;
}

/** Fetch all listings → Map of listingId → property name */
export async function fetchListings(): Promise<Map<number, string>> {
  const token = await getToken();
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

/** Fetch current + future reservations (excluding cancelled/declined) */
export async function fetchReservations(departureDateStart: string) {
  const token = await getToken();
  const all: any[] = [];
  let offset = 0;
  const allow = new Set(['new', 'confirmed', 'modified']);

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
