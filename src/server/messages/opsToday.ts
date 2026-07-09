import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz } from '@/src/lib/dates';

// Timezone-aware "today" for ops drafting (task triage, etc.).
//
// Dates/times are stored as bare wall-clock strings, so "today" must be resolved
// in a real-world timezone — otherwise late-evening US time has already rolled
// over to tomorrow in UTC, and relative references like "come tomorrow at 9am"
// land a day late. Resolution order, most specific first:
//   property.timezone → operations_settings.default_timezone → UTC.

/** An org's default IANA timezone (operations_settings is per-org), or undefined. */
export async function opsDefaultTimezone(orgId: string | null | undefined): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    const { data } = await getSupabaseServer()
      .from('operations_settings')
      .select('default_timezone')
      .eq('org_id', orgId)
      .maybeSingle();
    return (data as { default_timezone: string | null } | null)?.default_timezone ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Today's date (YYYY-MM-DD) for a property, resolved in its own timezone when
 * set, else ITS org's default, else UTC. Never throws — degrades to UTC.
 */
export async function resolveOpsToday(propertyId: string | null): Promise<string> {
  let tz: string | undefined;
  let orgId: string | null = null;
  if (propertyId) {
    try {
      const { data } = await getSupabaseServer()
        .from('properties')
        .select('timezone, org_id')
        .eq('id', propertyId)
        .maybeSingle();
      const row = data as { timezone: string | null; org_id: string | null } | null;
      tz = row?.timezone ?? undefined;
      orgId = row?.org_id ?? null;
    } catch {
      // Lookup failed — fall through to the org default.
    }
  }
  if (!tz) tz = await opsDefaultTimezone(orgId);
  return todayInTz(tz).date;
}
