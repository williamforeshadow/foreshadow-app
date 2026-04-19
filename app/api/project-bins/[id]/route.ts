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
    const {
      name,
      description,
      sort_order,
      auto_dismiss_enabled,
      auto_dismiss_days,
    } = body;

    const supabase = getSupabaseServer();

    // Look up the target row so we can enforce system-bin guardrails.
    const { data: existing, error: fetchErr } = await supabase
      .from('project_bins')
      .select('id, is_system')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: fetchErr?.message || 'Bin not found' },
        { status: 404 }
      );
    }

    const isSystemBin = !!(existing as any).is_system;

    const updateData: any = { updated_at: new Date().toISOString() };

    // System bins have a fixed identity: name, description, and sort order are
    // not user-editable. Silently drop those fields if someone tries to set them.
    if (!isSystemBin) {
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description || null;
      if (sort_order !== undefined) updateData.sort_order = sort_order;
    }

    if (auto_dismiss_enabled !== undefined) {
      updateData.auto_dismiss_enabled = !!auto_dismiss_enabled;
    }
    if (auto_dismiss_days !== undefined) {
      const parsed = Number(auto_dismiss_days);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 365) {
        return NextResponse.json(
          { error: 'auto_dismiss_days must be a number between 0 and 365' },
          { status: 400 }
        );
      }
      updateData.auto_dismiss_days = Math.round(parsed);
    }

    const { data, error } = await supabase
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

    // Reject attempts to delete a protected system bin.
    const { data: existing, error: fetchErr } = await supabase
      .from('project_bins')
      .select('id, is_system')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: fetchErr?.message || 'Bin not found' },
        { status: 404 }
      );
    }

    if ((existing as any).is_system) {
      return NextResponse.json(
        { error: 'System bins cannot be deleted.' },
        { status: 400 }
      );
    }

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
