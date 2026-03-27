import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - List all channels
export async function GET() {
  try {
    const { data, error } = await getSupabaseServer()
      .from('channels')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch channels' },
      { status: 500 }
    );
  }
}

// POST - Create a new channel
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, type, created_by, integration_source } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('channels')
      .insert({
        name: name.toLowerCase().replace(/\s+/g, '-'),
        description: description || null,
        type: type || 'general',
        created_by: created_by || null,
        integration_source: integration_source || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create channel' },
      { status: 500 }
    );
  }
}
