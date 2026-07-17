import { apiFetch } from '@/lib/apiFetch';

// Standard queryFn helper: routes through apiFetch (actor attribution header)
// and normalizes error handling — throws so React Query can retry/expose it.
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string })?.error || `Request failed (${res.status}): ${url}`
    );
  }
  return json as T;
}
