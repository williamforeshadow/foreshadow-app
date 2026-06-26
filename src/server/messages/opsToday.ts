import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz } from '@/src/lib/dates';

// Timezone-aware "today" for ops drafting (task triage, etc.).
//
// Dates/times are stored as bare wall-clock strings, so "today" must be resolved
// in a real-world timezone — otherwise late-evening US time has already rolled
// over to tomorrow in UTC, and relative references like "come tomorrow at 9am"
// land a day late. Resolution order, most specific first:
//   property.timezone → operations_settings.default_timezone → UTC.

/** The org-wide default IANA timezone (operations_settings.default_timezone), or undefined. */
export async function opsDefaultTimezone(): Promise<string | undefined> {
  try {
    const { data } = await getSupabaseServer()
      .from('operations_settings')
      .select('default_timezone')
      .eq('id', 1)
      .maybeSingle();
    return (data as { default_timezone: string | null } | null)?.default_timezone ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Today's date (YYYY-MM-DD) for a property, resolved in its own timezone when
 * set, else the org default, else UTC. Never throws — degrades to UTC.
 */
export async function resolveOpsToday(propertyId: string | null): Promise<string> {
  let tz: string | undefined;
  if (propertyId) {
    try {
      const { data } = await getSupabaseServer()
        .from('properties')
        .select('timezone')
        .eq('id', propertyId)
        .maybeSingle();
      tz = (data as { timezone: string | null } | null)?.timezone ?? undefined;
    } catch {
      // Lookup failed — fall through to the org default.
    }
  }
  if (!tz) tz = await opsDefaultTimezone();
  return todayInTz(tz).date;
}
