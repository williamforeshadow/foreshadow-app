import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// GET /api/templates/[id]/usage — delete-impact counts for the confirm
// dialog: how many pending untouched tasks the delete would remove, and how
// many historical/worked-on tasks survive (they keep rendering from their
// creation-time snapshot).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase } = ctx;

    const { data, error } = await supabase.rpc('template_delete_impact', {
      p_template_id: id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      pending_removed: (data as { pending_removed?: number })?.pending_removed ?? 0,
      kept: (data as { kept?: number })?.kept ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load template usage' },
      { status: 500 }
    );
  }
}
