import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// /api/operations-settings
//
// Singleton row in the `operations_settings` table (id = 1) that stores
// org-wide defaults: check-in / check-out times and the default timezone.
//
// Times are stored as plain Postgres TIME values (wall-clock, no TZ),
// matching the existing convention everywhere else in the app
// (turnover_tasks.scheduled_time, etc.).
//
// `default_timezone` is an IANA timezone string (e.g. "America/Los_Angeles")
// used as the org-wide fallback when a property doesn't have its own timezone
// set. It anchors wall-clock dates to a real-world location for features like
// the daily Slack digest and overdue-task resolution.

import { DEFAULT_TIMEZONE } from '@/src/lib/dates';

const FALLBACK_CHECK_IN = '15:00';
const FALLBACK_CHECK_OUT = '11:00';

// Postgres TIME comes back from PostgREST as 'HH:MM:SS'. The UI only ever
// cares about HH:MM, so trim consistently here.
function trimTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length >= 5 ? value.slice(0, 5) : value;
}

// Accept HH:MM and HH:MM:SS; reject anything else so we never write a malformed
// value back to the column. Returns the canonical 'HH:MM' form on success.
function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

// Postgres "undefined_table" — the operations_settings migration hasn't been
// applied yet. We treat this as a soft state: the UI keeps working with
// in-memory defaults and the settings page surfaces a "run the migration"
// banner instead of a hard error.
const PG_UNDEFINED_TABLE = '42P01';

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code === PG_UNDEFINED_TABLE) return true;
  return typeof e.message === 'string' && e.message.includes('operations_settings') && e.message.includes('does not exist');
}

export async function GET() {
  try {
    const supabase = getSupabaseServer();

    const { data, error } = await supabase
      .from('operations_settings')
      .select('default_check_in_time, default_check_out_time, default_timezone, updated_at')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      // Migration not applied yet — degrade gracefully so the rest of the app
      // (most importantly the ReservationDetailPanel filtering) keeps working
      // off in-memory defaults. The settings page surfaces a banner.
      if (isMissingTableError(error)) {
        return NextResponse.json({
          settings: {
            default_check_in_time: FALLBACK_CHECK_IN,
            default_check_out_time: FALLBACK_CHECK_OUT,
            default_timezone: DEFAULT_TIMEZONE,
            updated_at: null,
          },
          migration_pending: true,
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If the seed row hasn't been inserted yet (e.g. first run after migration
    // before the seed statement was applied), surface defaults so the UI never
    // sees a 500. The PUT path will create the row when the user saves.
    if (!data) {
      return NextResponse.json({
        settings: {
          default_check_in_time: FALLBACK_CHECK_IN,
          default_check_out_time: FALLBACK_CHECK_OUT,
          default_timezone: DEFAULT_TIMEZONE,
          updated_at: null,
        },
      });
    }

    return NextResponse.json({
      settings: {
        default_check_in_time: trimTime(data.default_check_in_time) || FALLBACK_CHECK_IN,
        default_check_out_time: trimTime(data.default_check_out_time) || FALLBACK_CHECK_OUT,
        default_timezone: data.default_timezone || DEFAULT_TIMEZONE,
        updated_at: data.updated_at,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load operations settings' },
      { status: 500 }
    );
  }
}

// Validate an IANA timezone string. Returns the canonical form on success, null
// on failure. We lean on Intl.DateTimeFormat for validation rather than
// maintaining a static list — the runtime knows every tz the ICU dataset has.
function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: value.trim() });
    const resolved = fmt.resolvedOptions().timeZone;
    return resolved;
  } catch {
    return null;
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const checkIn = normalizeTime(body?.default_check_in_time);
    const checkOut = normalizeTime(body?.default_check_out_time);

    if (!checkIn || !checkOut) {
      return NextResponse.json(
        {
          error:
            'default_check_in_time and default_check_out_time are required (HH:MM)',
        },
        { status: 400 }
      );
    }

    // Timezone is optional on existing requests (backwards compat). When
    // provided, validate it; when absent, omit from the upsert so the DB
    // default (or existing value) is preserved.
    let timezone: string | undefined;
    if (body?.default_timezone !== undefined) {
      const tz = normalizeTimezone(body.default_timezone);
      if (!tz) {
        return NextResponse.json(
          { error: 'default_timezone must be a valid IANA timezone string (e.g. "America/Los_Angeles")' },
          { status: 400 },
        );
      }
      timezone = tz;
    }

    const supabase = getSupabaseServer();

    const upsertPayload: Record<string, unknown> = {
      id: 1,
      default_check_in_time: checkIn,
      default_check_out_time: checkOut,
      updated_at: new Date().toISOString(),
    };
    if (timezone !== undefined) {
      upsertPayload.default_timezone = timezone;
    }

    const { data, error } = await supabase
      .from('operations_settings')
      .upsert(upsertPayload, { onConflict: 'id' })
      .select('default_check_in_time, default_check_out_time, default_timezone, updated_at')
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error:
              'operations_settings table is missing. Apply the migration in Supabase before saving.',
            migration_pending: true,
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      settings: {
        default_check_in_time: trimTime(data.default_check_in_time) || checkIn,
        default_check_out_time: trimTime(data.default_check_out_time) || checkOut,
        default_timezone: data.default_timezone || DEFAULT_TIMEZONE,
        updated_at: data.updated_at,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to save operations settings' },
      { status: 500 }
    );
  }
}
