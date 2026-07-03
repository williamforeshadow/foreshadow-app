import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// GET /api/turnovers
//
// Replaces the direct browser anon-client `supabase.rpc('get_property_turnovers')`
// calls (previously in useTurnovers/useTimeline/Timeline). Routed through the
// user-scoped client so the RPC (SECURITY INVOKER) runs with the caller's
// identity — once RLS is armed on its underlying tables, results are org-scoped
// automatically. Returns the raw RPC rows under `data`.
export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabase.rpc('get_property_turnovers');
  if (error) {
    console.error('[GET /api/turnovers] rpc error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
