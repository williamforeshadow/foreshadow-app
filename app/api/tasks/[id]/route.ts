import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// DELETE - Remove a task from a turnover card
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Delete the task
    const { error } = await getSupabaseServer()
      .from('turnover_tasks')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Task removed successfully'
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to remove task' },
      { status: 500 }
    );
  }
}

