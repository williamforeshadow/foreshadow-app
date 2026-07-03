import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabaseSession';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser, type CurrentAppUser } from '@/src/server/users/currentUser';

// Per-request auth + org guard for user-facing API routes (multi-tenant).
//
// Verifies the Supabase session (via the existing getCurrentAppUser resolver),
// then hands back a USER-SCOPED Supabase client whose queries are governed by
// RLS (auth.uid() is populated, so the `org_isolation` policies apply once
// armed), plus the verified acting user and their org.
//
// Usage in a user-facing route:
//   const ctx = await requireAuthContext();
//   if (ctx instanceof NextResponse) return ctx;      // 401 / 403
//   const { supabase, appUser, orgId } = ctx;
//   // reads/writes via `supabase` are RLS-governed; set org_id: orgId on writes.
//
// `supabase` — user-scoped; RLS-governed. `service` — service-role escape hatch
// (bypasses RLS) for rare cross-cutting needs; MUST be filtered by orgId in code.
// `appUser`  — the VERIFIED acting user (replaces the spoofable x-actor-user-id).

export type AuthedUser = CurrentAppUser & { org_id: string };

export type AuthContext = {
  supabase: SupabaseClient;
  service: SupabaseClient;
  appUser: AuthedUser;
  orgId: string;
};

export async function requireAuthContext(): Promise<AuthContext | NextResponse> {
  const { user, error } = await getCurrentAppUser();

  if (error === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (error === 'unlinked' || !user) {
    return NextResponse.json(
      { error: 'No Foreshadow profile is linked to this account' },
      { status: 403 },
    );
  }
  if (!user.org_id) {
    return NextResponse.json(
      { error: 'This account is not assigned to an organization' },
      { status: 403 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const service = getSupabaseServer();

  return { supabase, service, appUser: user as AuthedUser, orgId: user.org_id };
}
