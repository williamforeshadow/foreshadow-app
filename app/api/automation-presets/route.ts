import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET all automation presets
export async function GET() {
  try {
    const { data, error } = await getSupabaseServer()
      .from('automation_presets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ presets: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch automation presets' },
      { status: 500 }
    );
  }
}

// POST create new automation preset
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, trigger_type, config } = body;

    if (!name || !trigger_type || !config) {
      return NextResponse.json(
        { error: 'Name, trigger_type, and config are required' },
        { status: 400 }
      );
    }

    // Validate trigger_type
    const validTriggerTypes = ['turnover', 'occupancy', 'vacancy', 'recurring'];
    if (!validTriggerTypes.includes(trigger_type)) {
      return NextResponse.json(
        { error: `Invalid trigger_type. Must be one of: ${validTriggerTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('automation_presets')
      .insert({
        name,
        description: description || null,
        trigger_type,
        config
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ preset: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create automation preset' },
      { status: 500 }
    );
  }
}
