import { NextResponse } from 'next/server';
import {
  defaultNotificationPreference,
  NOTIFICATION_TYPES,
  type NotificationPreference,
  type NotificationType,
} from '@/lib/notifications';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    NOTIFICATION_TYPES.includes(value as NotificationType)
  );
}

async function requireUser() {
  const { user, error } = await getCurrentAppUser();
  if (error === 'unauthenticated') {
    return {
      response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }),
      user: null,
    };
  }
  if (error === 'unlinked' || !user) {
    return {
      response: NextResponse.json(
        { error: 'No Foreshadow profile is linked to this account' },
        { status: 403 },
      ),
      user: null,
    };
  }
  return { response: null, user };
}

export async function GET() {
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const { data, error } = await getSupabaseServer()
    .from('notification_preferences')
    .select('type, native_enabled, slack_enabled')
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byType = new Map(
    ((data ?? []) as NotificationPreference[]).map((pref) => [pref.type, pref]),
  );

  return NextResponse.json({
    preferences: NOTIFICATION_TYPES.map(
      (type) => byType.get(type) ?? defaultNotificationPreference(type),
    ),
  });
}

export async function PATCH(request: Request) {
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body?.preferences)
    ? body.preferences
    : body?.type
      ? [body]
      : [];

  const now = new Date().toISOString();
  const rows = incoming
    .filter((pref: Record<string, unknown>) => isNotificationType(pref.type))
    .map((pref: Record<string, unknown>) => ({
      user_id: user.id,
      type: pref.type as NotificationType,
      native_enabled:
        typeof pref.native_enabled === 'boolean' ? pref.native_enabled : true,
      slack_enabled:
        typeof pref.slack_enabled === 'boolean' ? pref.slack_enabled : false,
      updated_at: now,
    }));

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No valid notification preferences supplied' },
      { status: 400 },
    );
  }

  const { error } = await getSupabaseServer()
    .from('notification_preferences')
    .upsert(rows, { onConflict: 'user_id,type' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return GET();
}
