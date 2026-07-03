import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// Device-token registry for APNs push. The iOS app (Capacitor) registers its
// token here after the user grants notification permission, and removes it on
// sign-out. Auth matches the rest of the notification routes
// (app/api/notifications/route.ts) — the Supabase session identifies the user;
// writes go through the service-role client since device_tokens has RLS on
// with no client policies.

function normalizeEnvironment(value: unknown): 'production' | 'sandbox' {
  return value === 'sandbox' ? 'sandbox' : 'production';
}

function normalizePlatform(value: unknown): 'ios' | 'android' {
  return value === 'android' ? 'android' : 'ios';
}

export async function POST(request: Request) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser, orgId } = ctx;

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const now = new Date().toISOString();
  // Upsert on the unique token: re-registering the same device (or a device
  // that changed hands to another user) overwrites the owner and refreshes
  // last_seen_at rather than creating duplicates.
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      {
        user_id: appUser.id,
        token,
        platform: normalizePlatform(body?.platform),
        environment: normalizeEnvironment(body?.environment),
        last_seen_at: now,
        updated_at: now,
        org_id: orgId,
      },
      { onConflict: 'token' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  // Scope the delete to this user so one account can't unregister another's
  // device by guessing a token.
  const { error } = await supabase
    .from('device_tokens')
    .delete()
    .eq('token', token)
    .eq('user_id', appUser.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
