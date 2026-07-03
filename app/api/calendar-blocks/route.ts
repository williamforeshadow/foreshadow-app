import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// Read-only calendar-blocks feed for the multi-property Timeline. calendar_blocks
// is service-role-only (RLS on, no policies), so the browser can't read it
// directly the way it reads reservations/turnover_tasks — this route exposes
// just what the timeline needs. Future blocks only.
//
// Name resolution matters: the Timeline keys its rows by reservations.property_name
// (via get_property_turnovers), which can DRIFT from properties.name. So each
// block's property_name is resolved to that same reservation name (by property_id)
// — falling back to properties.name only when the property has no reservations —
// so a block lands on the same row as its property's bookings.
export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  const [blocksRes, resNamesRes, propNamesRes] = await Promise.all([
    supabase
      .from('calendar_blocks')
      .select('id, property_id, start_date, end_date, note')
      .gte('end_date', today)
      .order('start_date', { ascending: true }),
    supabase.from('reservations').select('property_id, property_name').not('property_id', 'is', null),
    supabase.from('properties').select('id, name'),
  ]);

  if (blocksRes.error) {
    return NextResponse.json({ error: blocksRes.error.message }, { status: 500 });
  }

  const resNameByProp = new Map<string, string>();
  for (const r of (resNamesRes.data || []) as Array<{ property_id: string | null; property_name: string | null }>) {
    if (r.property_id && r.property_name && !resNameByProp.has(r.property_id)) {
      resNameByProp.set(r.property_id, r.property_name);
    }
  }
  const propNameById = new Map<string, string>();
  for (const p of (propNamesRes.data || []) as Array<{ id: string; name: string | null }>) {
    if (p.id && p.name) propNameById.set(p.id, p.name);
  }

  const blocks = ((blocksRes.data || []) as Array<{
    id: string;
    property_id: string;
    start_date: string;
    end_date: string;
    note: string | null;
  }>).map((b) => ({
    id: b.id,
    property_id: b.property_id,
    property_name: resNameByProp.get(b.property_id) ?? propNameById.get(b.property_id) ?? null,
    start_date: b.start_date,
    end_date: b.end_date,
    note: b.note ?? null,
  }));

  return NextResponse.json({ blocks });
}
