import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  defaultNotificationPreference,
  NOTIFICATION_TYPES,
  type NotificationPreference,
  type NotificationType,
} from '@/lib/notifications';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { DEFAULT_TIMEZONE } from '@/src/lib/dates';

const DUE_TODAY_TIME_PATTERN = /^[0-2][0-9]:[0-5][0-9]$/;

async function getOrgTimezone(supabase: SupabaseClient, orgId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('operations_settings')
      .select('default_timezone')
      .eq('org_id', orgId)
      .maybeSingle();
    if (typeof data?.default_timezone === 'string' && data.default_timezone) {
      return data.default_timezone;
    }
  } catch {
    // operations_settings may not exist in older environments.
  }
  return DEFAULT_TIMEZONE;
}

function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    NOTIFICATION_TYPES.includes(value as NotificationType)
  );
}

export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser, orgId } = ctx;

  const [{ data, error }, orgTimezone] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select('type, native_enabled, slack_enabled, push_enabled, due_today_time')
      .eq('user_id', appUser.id),
    getOrgTimezone(supabase, orgId),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byType = new Map(
    ((data ?? []) as NotificationPreference[]).map((pref) => [pref.type, pref]),
  );

  return NextResponse.json({
    preferences: NOTIFICATION_TYPES.map((type) => {
      const fallback = defaultNotificationPreference(type);
      const saved = byType.get(type);
      if (!saved) return fallback;
      return {
        ...fallback,
        ...saved,
        // The DB column is nullable; surface a usable default in the API
        // response so the client doesn't need to know the magic constant.
        due_today_time:
          type === 'task_due_today'
            ? saved.due_today_time ?? fallback.due_today_time
            : null,
      };
    }),
    org_timezone: orgTimezone,
  });
}

export async function PATCH(request: Request) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser, orgId } = ctx;

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body?.preferences)
    ? body.preferences
    : body?.type
      ? [body]
      : [];

  const now = new Date().toISOString();
  const rows = incoming
    .filter((pref: Record<string, unknown>) => isNotificationType(pref.type))
    .map((pref: Record<string, unknown>) => {
      const type = pref.type as NotificationType;
      const row: {
        user_id: string;
        type: NotificationType;
        native_enabled: boolean;
        slack_enabled: boolean;
        push_enabled: boolean;
        updated_at: string;
        org_id: string;
        due_today_time?: string | null;
      } = {
        user_id: appUser.id,
        type,
        native_enabled:
          typeof pref.native_enabled === 'boolean' ? pref.native_enabled : true,
        slack_enabled:
          typeof pref.slack_enabled === 'boolean' ? pref.slack_enabled : false,
        push_enabled:
          typeof pref.push_enabled === 'boolean' ? pref.push_enabled : true,
        updated_at: now,
        org_id: orgId,
      };
      if (type === 'task_due_today') {
        const t = pref.due_today_time;
        if (typeof t === 'string' && DUE_TODAY_TIME_PATTERN.test(t)) {
          row.due_today_time = t;
        } else if (t === null) {
          row.due_today_time = null;
        }
      }
      return row;
    });

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No valid notification preferences supplied' },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(rows, { onConflict: 'user_id,type' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return GET();
}
