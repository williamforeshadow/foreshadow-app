import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseSession';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - Fetch all users
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const { data, error } = await getSupabaseServer()
      .from('users')
      .select('id, name, email, role, avatar')
      .order('name');

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Users API error:', err);
    const message = err instanceof Error ? err.message : 'Unknown users API error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

