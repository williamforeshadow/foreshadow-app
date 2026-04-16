import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function POST(request: Request) {
  try {
    const { taskId, fields } = await request.json();

    if (!taskId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'taskId and fields object are required' }, { status: 400 });
    }

    const allowedFields = ['title', 'description', 'priority', 'department_id', 'bin_id', 'is_binned', 'template_id', 'property_name'];
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const key of allowedFields) {
      if (key in fields) {
        updateData[key] = fields[key] ?? null;
      }
    }

    if (Object.keys(updateData).length === 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Guard: reject property_name/template_id changes if already set
    if ('property_name' in updateData || 'template_id' in updateData) {
      const { data: existing } = await getSupabaseServer()
        .from('turnover_tasks')
        .select('property_name, template_id')
        .eq('id', taskId)
        .single();

      if (existing) {
        if ('property_name' in updateData) {
          return NextResponse.json({ error: 'Property cannot be changed after task creation' }, { status: 400 });
        }
        if ('template_id' in updateData) {
          return NextResponse.json({ error: 'Template cannot be changed after task creation' }, { status: 400 });
        }
      }
    }

    const { data, error } = await getSupabaseServer()
      .from('turnover_tasks')
      .update(updateData)
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
