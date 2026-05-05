import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

const VALID_TRIGGERS = ['new_booking', 'check_in', 'check_out'];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('slack_automations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return NextResponse.json({ automation: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    update.name = body.name.trim();
  }
  if (body.enabled !== undefined) update.enabled = !!body.enabled;
  if (body.trigger !== undefined) {
    if (!VALID_TRIGGERS.includes(body.trigger)) {
      return NextResponse.json(
        { error: `trigger must be one of: ${VALID_TRIGGERS.join(', ')}` },
        { status: 400 },
      );
    }
    update.trigger = body.trigger;
  }
  if (body.property_ids !== undefined) {
    update.property_ids = Array.isArray(body.property_ids) ? body.property_ids : [];
  }
  if (body.config !== undefined) {
    if (typeof body.config !== 'object') {
      return NextResponse.json({ error: 'config must be an object' }, { status: 400 });
    }
    update.config = body.config;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('slack_automations')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[api/slack-automations] PUT failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ automation: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('slack_automations')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[api/slack-automations] DELETE failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
