import { NextResponse } from 'next/server';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  notifyTaskBinChanged,
  notifyTaskDescriptionChanged,
  notifyTaskPriorityChanged,
  notifyTaskTitleChanged,
} from '@/src/server/notifications/notify';

type PreviousTaskFields = {
  title: string | null;
  description: unknown;
  priority: string | null;
  bin_id: string | null;
  is_binned: boolean | null;
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export async function POST(request: Request) {
  try {
    const { taskId, fields } = await request.json();
    const actor = { user_id: getActorUserIdFromRequest(request) };

    if (!taskId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'taskId and fields object are required' }, { status: 400 });
    }

    const allowedFields = [
      'title',
      'description',
      'priority',
      'department_id',
      'bin_id',
      'is_binned',
      'template_id',
      'property_name',
      'property_id',
    ];
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

    const { data: previous } = await getSupabaseServer()
      .from('turnover_tasks')
      .select('title, description, priority, bin_id, is_binned, property_name, property_id, template_id')
      .eq('id', taskId)
      .single();

    const previousTask = (previous as PreviousTaskFields | null) ?? null;

    // Hard-block property/template reassignment on existing tasks.
    // Either side of (property_name, property_id) is rejected symmetrically.
    if (
      'property_name' in updateData ||
      'property_id' in updateData ||
      'template_id' in updateData
    ) {
      if (previous) {
        if ('property_name' in updateData || 'property_id' in updateData) {
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

    if (previousTask && 'title' in updateData) {
      await notifyTaskTitleChanged({
        taskId,
        beforeTitle: previousTask.title,
        afterTitle: data.title ?? null,
        actor,
      });
    }

    if (previousTask && 'priority' in updateData) {
      await notifyTaskPriorityChanged({
        taskId,
        beforePriority: previousTask.priority,
        afterPriority: data.priority ?? null,
        actor,
      });
    }

    if (previousTask && 'description' in updateData) {
      await notifyTaskDescriptionChanged({
        taskId,
        beforeDescription: previousTask.description,
        afterDescription: data.description ?? null,
        actor,
      });
    }

    if (previousTask && ('bin_id' in updateData || 'is_binned' in updateData)) {
      await notifyTaskBinChanged({
        taskId,
        before: {
          bin_id: previousTask.bin_id,
          is_binned: previousTask.is_binned,
        },
        after: {
          bin_id: data.bin_id ?? null,
          is_binned: data.is_binned ?? false,
        },
        actor,
      });
    }

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: unknown) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: errorMessage(error, 'An unexpected error occurred') },
      { status: 500 },
    );
  }
}
