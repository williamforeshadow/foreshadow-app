import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - Fetch all users
export async function GET() {
  try {
    const { data, error } = await getSupabaseServer()
      .from('users')
      .select('id, name, email, role, avatar')
      .order('name');

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Users API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

