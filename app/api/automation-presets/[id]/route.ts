import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET single automation preset
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { data, error } = await getSupabaseServer()
      .from('automation_presets')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Automation preset not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ preset: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch automation preset' },
      { status: 500 }
    );
  }
}

// PUT update automation preset
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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
      .update({
        name,
        description: description || null,
        trigger_type,
        config,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ preset: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update automation preset' },
      { status: 500 }
    );
  }
}

// DELETE automation preset
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { error } = await getSupabaseServer()
      .from('automation_presets')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete automation preset' },
      { status: 500 }
    );
  }
}
