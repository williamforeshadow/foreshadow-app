import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabaseSession';
import { getSupabaseServer } from '@/lib/supabaseServer';

type AppUser = {
  id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'manager' | 'staff';
  avatar?: string;
};

type UserRow = AppUser & {
  auth_user_id?: string | null;
};

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar ?? undefined,
  };
}

async function findAppUser(authUser: User): Promise<UserRow | null> {
  const service = getSupabaseServer();

  const byAuthId = await service
    .from('users')
    .select('id, name, email, role, avatar, auth_user_id')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (!byAuthId.error && byAuthId.data) {
    return byAuthId.data as UserRow;
  }

  const email = authUser.email?.trim().toLowerCase();
  if (!email) return null;

  const byEmail = await service
    .from('users')
    .select('id, name, email, role, avatar, auth_user_id')
    .ilike('email', email)
    .maybeSingle();

  if (!byEmail.error && byEmail.data) {
    const appUser = byEmail.data as UserRow;

    if ('auth_user_id' in appUser && !appUser.auth_user_id) {
      const { data } = await service
        .from('users')
        .update({ auth_user_id: authUser.id, updated_at: new Date().toISOString() })
        .eq('id', appUser.id)
        .select('id, name, email, role, avatar, auth_user_id')
        .single();

      return (data as UserRow | null) ?? appUser;
    }

    return appUser;
  }

  if (byEmail.error && byEmail.error.code === '42703') {
    const legacy = await service
      .from('users')
      .select('id, name, email, role, avatar')
      .ilike('email', email)
      .maybeSingle();

    if (!legacy.error && legacy.data) {
      return legacy.data as UserRow;
    }
  }

  return null;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();

  if (error || !authUser) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const appUser = await findAppUser(authUser);
  if (!appUser) {
    return NextResponse.json(
      { error: 'No Foreshadow profile is linked to this account' },
      { status: 403 },
    );
  }

  return NextResponse.json({ user: toAppUser(appUser) });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();

  if (error || !authUser) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const appUser = await findAppUser(authUser);
  if (!appUser) {
    return NextResponse.json(
      { error: 'No Foreshadow profile is linked to this account' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const updates: Record<string, string> = {};

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    updates.name = name;
  }

  if (typeof body.avatar === 'string') {
    updates.avatar = body.avatar;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ user: toAppUser(appUser) });
  }

  const { data, error: updateError } = await getSupabaseServer()
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', appUser.id)
    .select('id, name, email, role, avatar')
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ user: toAppUser(data as UserRow) });
}
