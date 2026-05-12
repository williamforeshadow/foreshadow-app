import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type {
  SlackAutomationConfig,
  SlackAutomationRecipient,
  SlackAutomationTrigger,
} from '@/lib/types';
import {
  SLACK_CONTEXT_LABELS,
  SLACK_TRIGGER_LABELS,
  getSlackAutomationDispatchTrigger,
  normalizeSlackAutomationConfig,
} from '@/lib/slackAutomationConfig';
import { DEFAULT_TIMEZONE, todayInTz } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { getTasksByIds } from '@/src/server/tasks/getTaskById';
import {
  buildSlackTaskLink,
  renderSlackAutomationPayload,
} from '@/src/server/slackAutomations/payload';
import { buildReservationVariables } from '@/src/server/slackAutomations/render';

const VALID_TRIGGERS = ['new_booking', 'check_in', 'check_out', 'task_assigned', 'scheduled'];

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

  const normalizedConfig = normalizeSlackAutomationConfig(config, { trigger });
  const normalizedTrigger = getSlackAutomationDispatchTrigger(normalizedConfig);
  const supabase = getSupabaseServer();
  const rendered =
    normalizedTrigger === 'scheduled'
      ? await renderScheduledPreview({
          supabase,
          config: normalizedConfig,
        })
      : normalizedTrigger === 'task_assigned'
      ? await renderTaskAssignmentPreview({
          supabase,
          config: normalizedConfig,
          taskId: typeof body?.sample_task_id === 'string' ? body.sample_task_id : undefined,
        })
      : await renderReservationPreview({
          supabase,
          config: normalizedConfig,
          trigger: normalizedTrigger,
          reservationId:
            typeof body?.sample_reservation_id === 'string'
              ? body.sample_reservation_id
              : undefined,
        });

  return NextResponse.json(rendered);
}

async function renderScheduledPreview(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
}) {
  const contextType = args.config.context?.type ?? 'reservation_turnover';
  if (contextType === 'task') {
    return renderScheduledTaskPreview(args);
  }
  if (contextType === 'property') {
    return renderScheduledPropertyPreview(args);
  }
  if (contextType === 'none') {
    return renderPayloadPreview({
      config: args.config,
      variables: {
        event_type: 'scheduled',
        event_name: SLACK_TRIGGER_LABELS.scheduled,
        trigger_date: todayInTz(DEFAULT_TIMEZONE).date,
        trigger_time: args.config.when?.schedule?.time ?? '07:00',
      },
      sample: { context: SLACK_CONTEXT_LABELS.none },
    });
  }
  return renderReservationPreview({
    supabase: args.supabase,
    config: args.config,
    trigger: 'scheduled',
  });
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
    event_type: 'task_assigned',
    event_name: SLACK_TRIGGER_LABELS.task_assigned,
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
    recipient_warnings: buildRecipientPreviewWarnings(config),
    sample: task
      ? { task_id: task.task_id, title }
      : { task_id: null, title: 'Sample task' },
  };
}

async function renderScheduledTaskPreview(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
}) {
  const task = await loadPreviewTask(args.supabase);
  const today = todayInTz(DEFAULT_TIMEZONE).date;
  return renderPayloadPreview({
    config: args.config,
    variables: {
      event_type: 'scheduled',
      event_name: SLACK_TRIGGER_LABELS.scheduled,
      trigger_date: today,
      trigger_time: args.config.when?.schedule?.time ?? '07:00',
      task_title: task?.title || task?.template_name || 'Sample task',
      task_status: task?.status ?? 'not_started',
      task_priority: task?.priority ?? 'normal',
      scheduled_date: task?.scheduled_date ?? today,
      scheduled_time: task?.scheduled_time ?? '10:00',
      property_id: '',
      property_name: task?.property_name ?? 'Sample Property',
      department_name: task?.department_name ?? 'Sample Department',
    },
    sample: task
      ? { task_id: task.task_id, title: task.title || task.template_name }
      : { task_id: null, title: 'Sample task' },
  });
}

async function renderScheduledPropertyPreview(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
}) {
  const { data } = await args.supabase
    .from('properties')
    .select('id, name, timezone')
    .limit(1);
  const property = (data ?? [])[0] as
    | { id: string; name: string | null; timezone: string | null }
    | undefined;
  const today = todayInTz(property?.timezone ?? DEFAULT_TIMEZONE).date;
  return renderPayloadPreview({
    config: args.config,
    variables: {
      event_type: 'scheduled',
      event_name: SLACK_TRIGGER_LABELS.scheduled,
      trigger_date: today,
      trigger_time: args.config.when?.schedule?.time ?? '07:00',
      property_id: property?.id ?? '',
      property_name: property?.name ?? 'Sample Property',
      property_timezone: property?.timezone ?? DEFAULT_TIMEZONE,
    },
    sample: property ?? { id: null, name: 'Sample Property' },
  });
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
    next_check_in: reservation?.next_check_in ?? today,
    trigger_date: today,
    default_check_in_time: '15:00',
    default_check_out_time: '11:00',
  });
  const eventVariables = {
    ...variables,
    event_type: trigger,
    event_name: SLACK_TRIGGER_LABELS[trigger] ?? trigger,
  };
  return renderPayloadPreview({
    config,
    variables: eventVariables as unknown as Record<string, string>,
    sample: reservation,
  });
}

function renderPayloadPreview(args: {
  config: SlackAutomationConfig;
  variables: Record<string, string>;
  sample: unknown;
}) {
  const payload = renderSlackAutomationPayload({
    config: args.config,
    variables: args.variables,
  });
  return {
    text: payload.text,
    blocks: payload.blocks ?? [],
    errors: payload.errors,
    recipient_warnings: buildRecipientPreviewWarnings(args.config),
    sample: args.sample,
  };
}

function buildRecipientPreviewWarnings(
  config: SlackAutomationConfig,
): string[] {
  const recipients = config.action?.recipients ?? [];
  if (recipients.length === 0) return ['No recipients are configured.'];
  return recipients.flatMap((recipient) =>
    buildRecipientWarning(recipient, getSlackAutomationDispatchTrigger(config)),
  );
}

function buildRecipientWarning(
  recipient: SlackAutomationRecipient,
  trigger: SlackAutomationTrigger,
): string[] {
  if (recipient.type === 'channel' && !recipient.channel_id) {
    return ['A channel recipient is missing a Slack channel.'];
  }
  if (recipient.type === 'user') {
    if (!recipient.user_id) return ['A user recipient is missing a selected user.'];
    if (!recipient.user_email) {
      return [
        `${recipient.user_name || 'A selected user'} has no email for Slack lookup.`,
      ];
    }
  }
  if (recipient.type === 'dynamic_user' && trigger !== 'task_assigned') {
    return [
      `${recipient.source.replaceAll('_', ' ')} is only available for task events.`,
    ];
  }
  return [];
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
      .select('id, property_id, property_name, guest_name, check_in, check_out, next_check_in')
      .eq('id', reservationId)
      .maybeSingle();
    return data;
  }

  let query = supabase
    .from('reservations')
    .select('id, property_id, property_name, guest_name, check_in, check_out, next_check_in')
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
