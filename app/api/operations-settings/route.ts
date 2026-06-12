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
const FALLBACK_SENSITIVITY = 2;
const FALLBACK_REPLY_SENSITIVITY = 3;

// Read the org task-proposal sensitivity (1-5) off a settings row, falling back
// to 2. Tolerates the column being absent (migration not yet applied).
function readSensitivity(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.round(n);
  return FALLBACK_SENSITIVITY;
}

// Validate an incoming sensitivity value; returns 1-5 or null.
function normalizeSensitivity(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

// Read the org reply-proposal sensitivity (1-4) off a settings row, falling back
// to 3. Tolerates the column being absent (migration not yet applied).
function readReplySensitivity(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 4) return Math.round(n);
  return FALLBACK_REPLY_SENSITIVITY;
}

// Validate an incoming reply sensitivity value; returns 1-4 or null.
function normalizeReplySensitivity(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 4 ? r : null;
}

// Concierge capability master switches — autonomous-generation gates that live
// alongside the sensitivity dial. Absent column (migration pending) reads as
// enabled; an unparseable value also falls back to true.
const CAPABILITY_FLAG_KEYS = [
  'reply_proposal_enabled',
  'task_proposal_enabled',
  'knowledge_proposal_enabled',
] as const;
type CapabilityFlagKey = (typeof CAPABILITY_FLAG_KEYS)[number];

function readBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

// Validate an incoming boolean flag; returns the boolean or null when absent/invalid.
function normalizeBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

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

// Postgres "undefined_column" — the task_proposal_sensitivity column hasn't been
// added yet (migration pending). Surfaced the same way as a missing table.
const PG_UNDEFINED_COLUMN = '42703';

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code === PG_UNDEFINED_COLUMN) return true;
  if (typeof e.message !== 'string') return false;
  return (
    e.message.includes('task_proposal_sensitivity') ||
    e.message.includes('reply_proposal_sensitivity') ||
    CAPABILITY_FLAG_KEYS.some((k) => e.message!.includes(k))
  );
}

export async function GET() {
  try {
    const supabase = getSupabaseServer();

    // select('*') so a not-yet-applied `task_proposal_sensitivity` column
    // doesn't error the whole query — it's simply absent and we fall back.
    const { data, error } = await supabase
      .from('operations_settings')
      .select('*')
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
            task_proposal_sensitivity: FALLBACK_SENSITIVITY,
            reply_proposal_sensitivity: FALLBACK_REPLY_SENSITIVITY,
            reply_proposal_enabled: true,
            task_proposal_enabled: true,
            knowledge_proposal_enabled: true,
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
          task_proposal_sensitivity: FALLBACK_SENSITIVITY,
          reply_proposal_sensitivity: FALLBACK_REPLY_SENSITIVITY,
          reply_proposal_enabled: true,
          task_proposal_enabled: true,
          knowledge_proposal_enabled: true,
          updated_at: null,
        },
      });
    }

    return NextResponse.json({
      settings: {
        default_check_in_time: trimTime(data.default_check_in_time) || FALLBACK_CHECK_IN,
        default_check_out_time: trimTime(data.default_check_out_time) || FALLBACK_CHECK_OUT,
        default_timezone: data.default_timezone || DEFAULT_TIMEZONE,
        task_proposal_sensitivity: readSensitivity(data.task_proposal_sensitivity),
        reply_proposal_sensitivity: readReplySensitivity(data.reply_proposal_sensitivity),
        reply_proposal_enabled: readBool(data.reply_proposal_enabled, true),
        task_proposal_enabled: readBool(data.task_proposal_enabled, true),
        knowledge_proposal_enabled: readBool(data.knowledge_proposal_enabled, true),
        updated_at: data.updated_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load operations settings' },
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save operations settings' },
      { status: 500 }
    );
  }
}

// PATCH — partial update. Accepts `task_proposal_sensitivity` (1-5) and the
// three concierge capability flags (booleans), in any subset, so the
// concierge-training page can change a single control without resending
// check-in/out times or timezone. Updates the singleton in place (or seeds it
// with fallbacks).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Collect the supported, present fields into the update payload, validating
    // each. An empty payload (no supported fields) is a 400.
    const patch: Record<string, unknown> = {};

    if (body?.task_proposal_sensitivity !== undefined) {
      const sensitivity = normalizeSensitivity(body.task_proposal_sensitivity);
      if (sensitivity === null) {
        return NextResponse.json(
          { error: 'task_proposal_sensitivity must be an integer between 1 and 5' },
          { status: 400 },
        );
      }
      patch.task_proposal_sensitivity = sensitivity;
    }

    if (body?.reply_proposal_sensitivity !== undefined) {
      const replySensitivity = normalizeReplySensitivity(body.reply_proposal_sensitivity);
      if (replySensitivity === null) {
        return NextResponse.json(
          { error: 'reply_proposal_sensitivity must be an integer between 1 and 4' },
          { status: 400 },
        );
      }
      patch.reply_proposal_sensitivity = replySensitivity;
    }

    for (const key of CAPABILITY_FLAG_KEYS) {
      if (body?.[key] === undefined) continue;
      const flag = normalizeBool(body[key]);
      if (flag === null) {
        return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
      }
      patch[key] = flag;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const now = new Date().toISOString();

    const { data: existing, error: readErr } = await supabase
      .from('operations_settings')
      .select('id')
      .eq('id', 1)
      .maybeSingle();
    if (readErr && isMissingTableError(readErr)) {
      return NextResponse.json(
        {
          error: 'operations_settings table is missing. Apply the migration in Supabase before saving.',
          migration_pending: true,
        },
        { status: 503 },
      );
    }

    const writeErr = existing
      ? (
          await supabase
            .from('operations_settings')
            .update({ ...patch, updated_at: now })
            .eq('id', 1)
        ).error
      : (
          await supabase.from('operations_settings').insert({
            id: 1,
            default_check_in_time: FALLBACK_CHECK_IN,
            default_check_out_time: FALLBACK_CHECK_OUT,
            default_timezone: DEFAULT_TIMEZONE,
            task_proposal_sensitivity: FALLBACK_SENSITIVITY,
            ...patch,
            updated_at: now,
          })
        ).error;

    if (writeErr) {
      if (isMissingTableError(writeErr) || isMissingColumnError(writeErr)) {
        return NextResponse.json(
          {
            error: 'These settings aren’t available yet. Apply the migration in Supabase.',
            migration_pending: true,
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: writeErr.message }, { status: 500 });
    }

    // Return the full, refreshed settings.
    return GET();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update operations settings' },
      { status: 500 },
    );
  }
}
