import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - List messages for a channel
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const channelId = searchParams.get('channel_id');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (!channelId) {
      return NextResponse.json(
        { error: 'channel_id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('messages')
      .select(`
        *,
        sender:users!messages_sender_id_fkey(id, name, avatar, role),
        action_user:users!messages_action_by_fkey(id, name, avatar)
      `)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      // If the join fails (e.g. foreign key names differ), try without joins
      const { data: fallbackData, error: fallbackError } = await getSupabaseServer()
        .from('messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (fallbackError) {
        return NextResponse.json({ error: fallbackError.message }, { status: 500 });
      }
      return NextResponse.json({ data: fallbackData || [] });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

// POST - Send a message
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      channel_id,
      sender_type,
      sender_id,
      sender_name,
      content,
      metadata,
      requires_action,
    } = body;

    if (!channel_id || !content) {
      return NextResponse.json(
        { error: 'channel_id and content are required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('messages')
      .insert({
        channel_id,
        sender_type: sender_type || 'user',
        sender_id: sender_id || null,
        sender_name: sender_name || null,
        content,
        metadata: metadata || {},
        requires_action: requires_action || false,
        action_status: requires_action ? 'pending' : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to send message' },
      { status: 500 }
    );
  }
}
