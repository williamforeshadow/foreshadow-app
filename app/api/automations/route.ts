import { NextResponse, NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  parseAutomationInput,
  summarizeAutomationFromRow,
} from '@/lib/automations/validate';

// CRUD for the rebuilt automations engine.
//
// Backed by the `automations` table created in
// supabase/migrations/20260512120000_automations_rebuild.sql. Migration
// must be applied before these routes work.

export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/automations] GET failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    automations: (data ?? []).map(summarizeAutomationFromRow),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;

  const body = await req.json();
  const parsed = parseAutomationInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }
  const { name, enabled, trigger, conditions, actions, property_ids } = parsed.value;

  const { data, error } = await supabase
    .from('automations')
    .insert({ name, enabled, trigger, conditions, actions, property_ids, org_id: orgId })
    .select()
    .single();

  if (error) {
    console.error('[api/automations] POST failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { automation: summarizeAutomationFromRow(data) },
    { status: 201 },
  );
}
