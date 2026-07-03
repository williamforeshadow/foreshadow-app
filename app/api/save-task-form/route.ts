import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase } = ctx;

    const { taskId, formData } = await request.json();

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('turnover_tasks')
      .update({ 
        form_metadata: formData,
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('getSupabaseServer() error:', error);
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

