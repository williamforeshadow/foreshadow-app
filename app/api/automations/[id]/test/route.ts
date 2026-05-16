import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { testFireAutomation } from '@/src/server/automations/run';

// POST /api/automations/[id]/test
//
// Fires the automation against a sample row, bypassing conditions and dedup.
// Posts a "[TEST] ..." message to whatever channels the automation declares.
//
// Body shape (all optional):
//   { sample_row: Record<string, unknown> }   // hand-crafted sample
//   {}                                         // auto-pick most recent reservation
//
// We don't accept arbitrary entity selection yet — the runtime only supports
// reservation row_change triggers in this commit, so we hydrate against the
// most recent reservation when no sample is given.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { sample_row?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine.
  }

  let sampleRow = body.sample_row;
  if (!sampleRow) {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .order('check_in', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: `couldn't load a sample reservation: ${error.message}` },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'no reservations exist yet — pass sample_row in the body' },
        { status: 400 },
      );
    }
    sampleRow = data as Record<string, unknown>;
  }

  const result = await testFireAutomation(id, sampleRow);
  return NextResponse.json({ result });
}
