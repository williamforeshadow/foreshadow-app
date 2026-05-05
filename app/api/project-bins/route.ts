import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { createBin } from '@/src/server/bins/createBin';

// GET - List all bins with project counts
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    const { data: bins, error } = await supabase
      .from('project_bins')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get task counts per bin (tasks are the unified entity now)
    const { data: counts } = await supabase
      .from('turnover_tasks')
      .select('bin_id')
      .eq('is_binned', true);

    const countMap: Record<string, number> = {};
    (counts || []).forEach((row: any) => {
      if (row.bin_id) {
        countMap[row.bin_id] = (countMap[row.bin_id] || 0) + 1;
      }
    });

    const totalBinnedCount = counts?.length || 0;

    const enrichedBins = (bins || []).map((bin: any) => ({
      ...bin,
      project_count: countMap[bin.id] || 0,
    }));

    return NextResponse.json({
      data: enrichedBins,
      total_projects: totalBinnedCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch bins' },
      { status: 500 }
    );
  }
}

// POST - Create a new sub-bin.
//
// Thin wrapper over the canonical createBin service. The service owns
// validation, FK pre-checks, sort_order assignment, and case-insensitive
// duplicate-name detection — everything the agent's create_bin tool
// also calls into. Both surfaces emit structurally identical rows.
//
// Why mirror this through a service rather than keep the inline insert:
// the bins agent (preview_bin / create_bin) needs the same error codes
// the route returns, and a service is the single place to evolve them
// without drift. See src/server/bins/createBin.ts.
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await createBin({
      name: body?.name,
      description: body?.description ?? null,
      created_by: body?.created_by ?? null,
    });

    if (!result.ok) {
      const status =
        result.error.code === 'invalid_input'
          ? 400
          : result.error.code === 'duplicate_name'
            ? 409
            : result.error.code === 'not_found'
              ? 404
              : 500;
      return NextResponse.json(
        { error: result.error.message, code: result.error.code, field: result.error.field },
        { status },
      );
    }

    // Preserve the existing client contract: the bins page reads
    // `data.project_count` to render the per-tile task count. New bins
    // always start at 0.
    return NextResponse.json({ data: { ...result.bin, project_count: 0 } });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create bin' },
      { status: 500 }
    );
  }
}
