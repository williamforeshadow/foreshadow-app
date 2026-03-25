import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// PUT - Update a bin
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, sort_order } = body;

    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description || null;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    const { data, error } = await getSupabaseServer()
      .from('project_bins')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update bin' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a bin (projects become unbinned)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServer();

    // Set bin_id = null on all projects in this bin
    await supabase
      .from('property_projects')
      .update({ bin_id: null })
      .eq('bin_id', id);

    // Delete the bin
    const { error } = await supabase
      .from('project_bins')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete bin' },
      { status: 500 }
    );
  }
}
