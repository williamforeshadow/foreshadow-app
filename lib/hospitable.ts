/**
 * Hospitable Public API v2 client — server-side only.
 *
 * Auth is a per-integration Personal Access Token (Bearer). Mirrors the shape of
 * lib/hostaway.ts (every fetcher takes creds) so the sync/webhook paths look the
 * same across PMSes.
 *
 * Docs: https://developer.hospitable.com/docs/public-api-docs (v2). Responses are
 * `{ data: [...], meta: { last_page, ... }, links: {...} }`. The exact per-record
 * FIELD NAMES are interpreted by the sync/ingest layer (finalized against real
 * responses), not here — this client stays field-agnostic and just returns rows.
 */
import type { HospitableCreds } from '@/lib/pmsIntegrations';

const BASE_URL = 'https://api.hospitable.com/v2';

type Params = Record<string, string | number | boolean | undefined>;

async function hospitableFetch(
  creds: HospitableCreds,
  path: string,
  params?: Params,
): Promise<any> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hospitable ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

/** Walk `?page=N` pagination, collecting `data` rows until the last page. */
async function fetchAllPages(
  creds: HospitableCreds,
  path: string,
  params: Params = {},
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  // Hard cap so a misbehaving meta can't loop forever.
  for (let guard = 0; guard < 500; guard++) {
    const json = await hospitableFetch(creds, path, { ...params, page });
    const rows: any[] = Array.isArray(json?.data) ? json.data : [];
    all.push(...rows);
    const lastPage = Number(json?.meta?.last_page);
    if (!Number.isFinite(lastPage) || page >= lastPage || rows.length === 0) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 300)); // gentle on rate limits
  }
  return all;
}

/** All properties/listings on the account. */
export async function fetchHospitableProperties(creds: HospitableCreds): Promise<any[]> {
  return fetchAllPages(creds, '/properties');
}

/** Reservations, optionally filtered (e.g. { start_date, end_date, properties }).
 *  Filter param names are confirmed against real responses before wiring the sync. */
export async function fetchHospitableReservations(
  creds: HospitableCreds,
  params: Params = {},
): Promise<any[]> {
  return fetchAllPages(creds, '/reservations', params);
}

/** Full message thread for a reservation (both directions). */
export async function fetchHospitableReservationMessages(
  creds: HospitableCreds,
  reservationUuid: string,
): Promise<any[]> {
  const json = await hospitableFetch(creds, `/reservations/${reservationUuid}/messages`);
  return Array.isArray(json?.data) ? json.data : [];
}

/** Send a host message on a reservation's thread. */
export async function sendHospitableMessage(
  creds: HospitableCreds,
  reservationUuid: string,
  body: string,
): Promise<any> {
  const res = await fetch(`${BASE_URL}/reservations/${reservationUuid}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`Hospitable send message failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
