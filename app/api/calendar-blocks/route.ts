import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// Read-only calendar-blocks feed for the multi-property Timeline. calendar_blocks
// is service-role-only (RLS on, no policies), so the browser can't read it
// directly the way it reads reservations/turnover_tasks — this route exposes
// just what the timeline needs. Future blocks only.
//
// Name resolution: property_name is now a guaranteed mirror of properties.name
// (enforced by the derive_property_name() trigger on reservations/turnover_tasks),
// so a block's timeline row is resolved straight from properties.name by
// property_id — it always lands on the same row as its property's bookings.
export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  const [blocksRes, propNamesRes] = await Promise.all([
    supabase
      .from('calendar_blocks')
      .select('id, property_id, start_date, end_date, note')
      .gte('end_date', today)
      .order('start_date', { ascending: true }),
    supabase.from('properties').select('id, name'),
  ]);

  if (blocksRes.error) {
    return NextResponse.json({ error: blocksRes.error.message }, { status: 500 });
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
    property_name: propNameById.get(b.property_id) ?? null,
    start_date: b.start_date,
    end_date: b.end_date,
    note: b.note ?? null,
  }));

  return NextResponse.json({ blocks });
}
