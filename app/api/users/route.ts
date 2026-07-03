import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// GET - Fetch all users
export async function GET() {
  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase } = ctx;

    const { data, error } = await supabase
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
