import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

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

    // Get project counts per bin
    const { data: counts } = await supabase
      .from('property_projects')
      .select('bin_id')
      .not('bin_id', 'is', null);

    const countMap: Record<string, number> = {};
    (counts || []).forEach((row: any) => {
      if (row.bin_id) {
        countMap[row.bin_id] = (countMap[row.bin_id] || 0) + 1;
      }
    });

    // Also count projects with no bin
    const { count: unbinnedCount } = await supabase
      .from('property_projects')
      .select('id', { count: 'exact', head: true })
      .is('bin_id', null);

    const enrichedBins = (bins || []).map((bin: any) => ({
      ...bin,
      project_count: countMap[bin.id] || 0,
    }));

    return NextResponse.json({
      data: enrichedBins,
      total_projects: (counts?.length || 0) + (unbinnedCount || 0),
      unbinned_count: unbinnedCount || 0,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch bins' },
      { status: 500 }
    );
  }
}

// POST - Create a new bin
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, created_by } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServer();

    // Get max sort_order to append at end
    const { data: maxRow } = await supabase
      .from('project_bins')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    const nextSort = (maxRow?.sort_order ?? -1) + 1;

    const { data: bin, error } = await supabase
      .from('project_bins')
      .insert({
        name: name.trim(),
        description: description || null,
        created_by: created_by || null,
        sort_order: nextSort,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: { ...bin, project_count: 0 } });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create bin' },
      { status: 500 }
    );
  }
}
