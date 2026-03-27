import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST - Approve, reject, or edit a message
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message_id, action_status, action_by, edited_content } = body;

    if (!message_id || !action_status || !action_by) {
      return NextResponse.json(
        { error: 'message_id, action_status, and action_by are required' },
        { status: 400 }
      );
    }

    if (!['approved', 'rejected'].includes(action_status)) {
      return NextResponse.json(
        { error: 'action_status must be "approved" or "rejected"' },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {
      action_status,
      action_by,
      action_at: new Date().toISOString(),
    };

    // If edited content is provided (edit + approve)
    if (edited_content) {
      updatePayload.edited_content = edited_content;
    }

    const { data, error } = await getSupabaseServer()
      .from('messages')
      .update(updatePayload)
      .eq('id', message_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update message' },
      { status: 500 }
    );
  }
}
