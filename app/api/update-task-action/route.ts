import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(request: Request) {
  try {
    const { taskId, action } = await request.json();

    if (!taskId || !action) {
      return NextResponse.json({ error: 'Task ID and action are required' }, { status: 400 });
    }

    const allowedActions = ['not_started', 'in_progress', 'paused', 'completed', 'reopened'];
    if (!allowedActions.includes(action)) {
      return NextResponse.json({ error: 'Invalid action provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('turnover_tasks')
      .update({ card_actions: action })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 });
  }
}

