import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type {
  SlackAutomationConfig,
  SlackAutomationTrigger,
} from '@/lib/types';
import { DEFAULT_TIMEZONE, todayInTz } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds } from '@/src/server/tasks/getTaskById';
import {
  buildSlackTaskLink,
  renderSlackAutomationPayload,
} from '@/src/server/slackAutomations/payload';
import { buildReservationVariables } from '@/src/server/slackAutomations/render';

const VALID_TRIGGERS = ['new_booking', 'check_in', 'check_out', 'task_assigned'];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const trigger = body?.trigger as SlackAutomationTrigger | undefined;
  const config = body?.config as SlackAutomationConfig | undefined;

  if (!trigger || !VALID_TRIGGERS.includes(trigger)) {
    return NextResponse.json({ error: 'A valid trigger is required.' }, { status: 400 });
  }
  if (!config || typeof config !== 'object') {
    return NextResponse.json({ error: 'A config object is required.' }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const rendered =
    trigger === 'task_assigned'
      ? await renderTaskAssignmentPreview({
          supabase,
          config,
          taskId: typeof body?.sample_task_id === 'string' ? body.sample_task_id : undefined,
        })
      : await renderReservationPreview({
          supabase,
          config,
          trigger,
          reservationId:
            typeof body?.sample_reservation_id === 'string'
              ? body.sample_reservation_id
              : undefined,
        });

  return NextResponse.json(rendered);
}

async function renderTaskAssignmentPreview(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
  taskId?: string;
}) {
  const { supabase, config, taskId } = args;
  const task = await loadPreviewTask(supabase, taskId);
  const title = task?.title || task?.template_name || 'Sample task';
  const url = task ? taskUrl(task.task_id) : taskUrl('00000000-0000-0000-0000-000000000000');
  const variables: Record<string, string> = {
    actor_name: 'Sample Actor',
    actor_email: 'actor@example.com',
    assignee_name: 'Sample Assignee',
    assignee_email: 'assignee@example.com',
    task_title: title,
    task_url: url,
    task_link: buildSlackTaskLink({ url, title }),
    task_status: task?.status ?? 'not_started',
    task_priority: task?.priority ?? 'normal',
    property_name: task?.property_name ?? 'Sample Property',
    department_name: task?.department_name ?? 'Sample Department',
    scheduled_date: task?.scheduled_date ?? todayInTz(DEFAULT_TIMEZONE).date,
    scheduled_time: task?.scheduled_time ?? '10:00',
    trigger_date: todayInTz(DEFAULT_TIMEZONE).date,
  };

  const payload = renderSlackAutomationPayload({
    config,
    variables,
    taskCard: task ? { task, url } : undefined,
  });

  return {
    text: payload.text,
    blocks: payload.blocks ?? [],
    errors: payload.errors,
    sample: task
      ? { task_id: task.task_id, title }
      : { task_id: null, title: 'Sample task' },
  };
}

async function renderReservationPreview(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
  trigger: SlackAutomationTrigger;
  reservationId?: string;
}) {
  const { supabase, config, trigger, reservationId } = args;
  const reservation = await loadPreviewReservation(supabase, trigger, reservationId);
  const today = todayInTz(DEFAULT_TIMEZONE).date;
  const variables = buildReservationVariables({
    property_name: reservation?.property_name ?? '(sample) Property',
    guest_name: reservation?.guest_name ?? '(sample) Guest',
    check_in: reservation?.check_in ?? today,
    check_out: reservation?.check_out ?? today,
    trigger_date: today,
    default_check_in_time: '15:00',
    default_check_out_time: '11:00',
  });
  const payload = renderSlackAutomationPayload({
    config,
    variables: variables as unknown as Record<string, string>,
  });

  return {
    text: payload.text,
    blocks: payload.blocks ?? [],
    errors: payload.errors,
    sample: reservation,
  };
}

async function loadPreviewTask(
  supabase: ReturnType<typeof getSupabaseServer>,
  taskId?: string,
) {
  const taskIds = taskId ? [taskId] : [];
  if (!taskId) {
    const { data } = await supabase
      .from('turnover_tasks')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    const first = (data ?? [])[0] as { id: string } | undefined;
    if (first?.id) taskIds.push(first.id);
  }
  if (taskIds.length === 0) return null;
  const tasks = await getTasksByIds(taskIds);
  return tasks[0] ?? null;
}

async function loadPreviewReservation(
  supabase: ReturnType<typeof getSupabaseServer>,
  trigger: SlackAutomationTrigger,
  reservationId?: string,
) {
  if (reservationId) {
    const { data } = await supabase
      .from('reservations')
      .select('id, property_id, property_name, guest_name, check_in, check_out')
      .eq('id', reservationId)
      .maybeSingle();
    return data;
  }

  let query = supabase
    .from('reservations')
    .select('id, property_id, property_name, guest_name, check_in, check_out')
    .limit(1);
  const today = new Date().toISOString().split('T')[0];
  if (trigger === 'check_in') {
    query = query.gte('check_in', today).order('check_in', { ascending: true });
  } else if (trigger === 'check_out') {
    query = query.gte('check_out', today).order('check_out', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  const { data } = await query;
  return (data ?? [])[0] ?? null;
}
