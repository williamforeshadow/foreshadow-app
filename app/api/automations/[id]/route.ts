import { NextResponse, NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  parseAutomationInput,
  summarizeAutomationFromRow,
} from '@/lib/automations/validate';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return NextResponse.json({ automation: summarizeAutomationFromRow(data) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;
  const body = await req.json();
  const parsed = parseAutomationInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }
  const { name, enabled, trigger, conditions, actions, property_ids } = parsed.value;

  const { data, error } = await supabase
    .from('automations')
    .update({
      name,
      enabled,
      trigger,
      conditions,
      actions,
      property_ids,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[api/automations] PUT failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ automation: summarizeAutomationFromRow(data) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;
  const { error } = await supabase
    .from('automations')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[api/automations] DELETE failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
