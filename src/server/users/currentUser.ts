import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabaseSession';
import { getSupabaseServer } from '@/lib/supabaseServer';

export type AppRole = 'superadmin' | 'manager' | 'staff';

export interface CurrentAppUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  avatar?: string | null;
}

interface UserRow extends CurrentAppUser {
  auth_user_id?: string | null;
}

export async function findCurrentAppUserFromAuth(
  authUser: User,
): Promise<CurrentAppUser | null> {
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

  if (byEmail.error?.code === '42703') {
    const legacy = await service
      .from('users')
      .select('id, name, email, role, avatar')
      .ilike('email', email)
      .maybeSingle();
    if (!legacy.error && legacy.data) return legacy.data as UserRow;
  }

  return null;
}

export async function getCurrentAppUser(): Promise<{
  user: CurrentAppUser | null;
  error: 'unauthenticated' | 'unlinked' | null;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();

  if (error || !authUser) {
    return { user: null, error: 'unauthenticated' };
  }

  const appUser = await findCurrentAppUserFromAuth(authUser);
  if (!appUser) {
    return { user: null, error: 'unlinked' };
  }

  return { user: appUser, error: null };
}
