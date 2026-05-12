import { WebClient } from '@slack/web-api';
import {
  defaultNotificationPreference,
  NOTIFICATION_TYPES,
  type NotificationPreference,
  type NotificationType,
} from '@/lib/notifications';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { taskPath, taskUrl } from '@/src/lib/links';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { lookupSlackUserByEmail } from '@/src/slack/identity';

export interface NotificationActor {
  user_id: string | null;
  name?: string | null;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

interface UserRef {
  id: string;
  name: string | null;
  email: string | null;
}

interface TaskContext {
  id: string;
  title: string;
  property_name: string | null;
  status: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  updated_at: string | null;
  assignments: Array<{
    user_id: string;
    assigned_at: string | null;
    user: UserRef | null;
  }>;
}

interface TaskAssignmentRow {
  user_id: string;
  assigned_at: string | null;
  users: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
}

interface TaskContextRow {
  id: string;
  title: string | null;
  property_name: string | null;
  status: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  updated_at: string | null;
  task_assignments?: TaskAssignmentRow[] | null;
}

interface RenderPayload {
  type: NotificationType;
  task: TaskContext;
  actorName: string | null;
  metadata?: Record<string, unknown>;
}

interface RenderedNotification {
  title: string;
  body: string;
  slackText: string;
}

const STATUS_LABELS: Record<string, string> = {
  contingent: 'Contingent',
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
};

function statusLabel(status: unknown): string {
  return typeof status === 'string'
    ? STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
    : 'Unknown';
}

function formatSchedule(date: unknown, time: unknown): string {
  const dateText = typeof date === 'string' && date ? date : 'unscheduled';
  const timeText = typeof time === 'string' && time ? ` at ${time}` : '';
  return `${dateText}${timeText}`;
}

function compactPreview(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function taskLabel(task: TaskContext): string {
  return task.title || 'Untitled task';
}

function renderNotification(payload: RenderPayload): RenderedNotification {
  const { type, task, actorName, metadata = {} } = payload;
  const taskName = taskLabel(task);
  const where = task.property_name ? ` at ${task.property_name}` : '';
  const actor = actorName || 'Someone';

  if (type === 'task_created_assigned') {
    const title = `New task assigned: ${taskName}`;
    const body = `You were assigned to ${taskName}${where}.`;
    return { title, body, slackText: `${title}\n${body}\n${taskUrl(task.id)}` };
  }

  if (type === 'task_assigned') {
    const title = `Assigned to ${taskName}`;
    const body = `${actor} assigned you to ${taskName}${where}.`;
    return { title, body, slackText: `${title}\n${body}\n${taskUrl(task.id)}` };
  }

  if (type === 'task_commented') {
    const preview = compactPreview(metadata.comment_preview);
    const title = `New comment on ${taskName}`;
    const body = preview
      ? `${actor} commented: "${preview}"`
      : `${actor} commented on ${taskName}${where}.`;
    return { title, body, slackText: `${title}\n${body}\n${taskUrl(task.id)}` };
  }

  if (type === 'task_schedule_changed') {
    const before = formatSchedule(metadata.before_date, metadata.before_time);
    const after = formatSchedule(metadata.after_date, metadata.after_time);
    const title = `Schedule changed: ${taskName}`;
    const body = `${actor} changed the schedule from ${before} to ${after}.`;
    return { title, body, slackText: `${title}\n${body}\n${taskUrl(task.id)}` };
  }

  if (type === 'task_status_changed') {
    const before = statusLabel(metadata.before_status);
    const after = statusLabel(metadata.after_status);
    const title = `Status changed: ${taskName}`;
    const body = `${actor} changed the status from ${before} to ${after}.`;
    return { title, body, slackText: `${title}\n${body}\n${taskUrl(task.id)}` };
  }

  const schedule = formatSchedule(task.scheduled_date, task.scheduled_time);
  const title = `Due today: ${taskName}`;
  const body = `${taskName}${where} is scheduled for ${schedule}.`;
  return { title, body, slackText: `${title}\n${body}\n${taskUrl(task.id)}` };
}

async function loadActorName(
  supabase: Supabase,
  actor?: NotificationActor | null,
): Promise<string | null> {
  if (!actor?.user_id) return actor?.name ?? null;
  if (actor.name) return actor.name;
  const { data } = await supabase
    .from('users')
    .select('name')
    .eq('id', actor.user_id)
    .maybeSingle();
  return typeof data?.name === 'string' ? data.name : null;
}

async function loadTaskContext(
  supabase: Supabase,
  taskId: string,
): Promise<TaskContext | null> {
  const { data, error } = await supabase
    .from('turnover_tasks')
    .select(
      `
      id,
      title,
      property_name,
      status,
      scheduled_date,
      scheduled_time,
      updated_at,
      task_assignments(
        user_id,
        assigned_at,
        users(id, name, email)
      )
    `,
    )
    .eq('id', taskId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn('[notifications] task lookup failed', { taskId, error });
    return null;
  }

  const row = data as TaskContextRow;
  const assignments = (row.task_assignments ?? []).map((a) => ({
    user_id: a.user_id,
    assigned_at: a.assigned_at ?? null,
    user: a.users
      ? {
          id: a.users.id,
          name: a.users.name ?? null,
          email: a.users.email ?? null,
        }
      : null,
  }));

  return {
    id: row.id,
    title: row.title ?? 'Untitled task',
    property_name: row.property_name ?? null,
    status: row.status ?? null,
    scheduled_date: row.scheduled_date ?? null,
    scheduled_time: row.scheduled_time ?? null,
    updated_at: row.updated_at ?? null,
    assignments,
  };
}

async function loadPreferences(
  supabase: Supabase,
  userIds: string[],
): Promise<Map<string, Map<NotificationType, NotificationPreference>>> {
  const prefs = new Map<string, Map<NotificationType, NotificationPreference>>();
  for (const id of userIds) prefs.set(id, new Map());
  if (userIds.length === 0) return prefs;

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('user_id, type, native_enabled, slack_enabled')
    .in('user_id', userIds);

  if (error) {
    console.warn('[notifications] preference lookup failed', { error });
    return prefs;
  }

  for (const row of (data ?? []) as Array<{
    user_id: string;
    type: NotificationType;
    native_enabled: boolean;
    slack_enabled: boolean;
  }>) {
    if (!NOTIFICATION_TYPES.includes(row.type)) continue;
    prefs.get(row.user_id)?.set(row.type, {
      type: row.type,
      native_enabled: row.native_enabled,
      slack_enabled: row.slack_enabled,
    });
  }
  return prefs;
}

function preferenceFor(
  prefs: Map<string, Map<NotificationType, NotificationPreference>>,
  userId: string,
  type: NotificationType,
): NotificationPreference {
  return prefs.get(userId)?.get(type) ?? defaultNotificationPreference(type);
}

async function sendSlackDm(args: {
  notificationId: string;
  email: string | null;
  text: string;
}) {
  const supabase = getSupabaseServer();
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    await supabase
      .from('notifications')
      .update({ slack_error: 'Missing SLACK_BOT_TOKEN', updated_at: new Date().toISOString() })
      .eq('id', args.notificationId);
    return;
  }
  if (!args.email) {
    await supabase
      .from('notifications')
      .update({ slack_error: 'Recipient has no email', updated_at: new Date().toISOString() })
      .eq('id', args.notificationId);
    return;
  }

  try {
    const web = new WebClient(token);
    const slackUser = await lookupSlackUserByEmail(web, args.email);
    if (!slackUser) {
      await supabase
        .from('notifications')
        .update({ slack_error: 'No Slack user found for email', updated_at: new Date().toISOString() })
        .eq('id', args.notificationId);
      return;
    }

    await web.chat.postMessage({
      channel: slackUser.slackUserId,
      text: args.text,
      unfurl_links: false,
      unfurl_media: false,
    });
    await supabase
      .from('notifications')
      .update({
        slack_sent_at: new Date().toISOString(),
        slack_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.notificationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Slack send failed';
    await supabase
      .from('notifications')
      .update({ slack_error: message, updated_at: new Date().toISOString() })
      .eq('id', args.notificationId);
  }
}

async function deliverTaskNotification(args: {
  type: NotificationType;
  taskId: string;
  recipientIds: string[];
  actor?: NotificationActor | null;
  metadata?: Record<string, unknown>;
  dedupeKeyFor: (recipientId: string, task: TaskContext) => string;
}) {
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;

  const actorId = args.actor?.user_id ?? null;
  const recipientSet = new Set(
    args.recipientIds.filter((id) => id && id !== actorId),
  );
  if (recipientSet.size === 0) return;

  const actorName = await loadActorName(supabase, args.actor);
  const prefs = await loadPreferences(supabase, [...recipientSet]);
  const rendered = renderNotification({
    type: args.type,
    task,
    actorName,
    metadata: args.metadata,
  });

  for (const recipientId of recipientSet) {
    const recipient = task.assignments.find((a) => a.user_id === recipientId);
    const preference = preferenceFor(prefs, recipientId, args.type);
    if (!preference.native_enabled && !preference.slack_enabled) continue;

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: args.type,
        user_id: recipientId,
        actor_user_id: actorId,
        entity_type: 'task',
        entity_id: task.id,
        title: rendered.title,
        body: rendered.body,
        href: taskPath(task.id),
        metadata: args.metadata ?? {},
        native_visible: preference.native_enabled,
        dedupe_key: args.dedupeKeyFor(recipientId, task),
      })
      .select('id')
      .single();

    if (error) {
      if (error.code !== '23505') {
        console.warn('[notifications] insert failed', {
          type: args.type,
          taskId: task.id,
          recipientId,
          error,
        });
      }
      continue;
    }

    if (preference.slack_enabled && data?.id) {
      await sendSlackDm({
        notificationId: data.id as string,
        email: recipient?.user?.email ?? null,
        text: rendered.slackText,
      });
    }
  }
}

export async function notifyTaskCreatedAssigned(args: {
  taskId: string;
  assigneeIds: string[];
  actor?: NotificationActor | null;
}) {
  await deliverTaskNotification({
    type: 'task_created_assigned',
    taskId: args.taskId,
    recipientIds: args.assigneeIds,
    actor: args.actor,
    dedupeKeyFor: (recipientId, task) => {
      const assignedAt =
        task.assignments.find((a) => a.user_id === recipientId)?.assigned_at ??
        task.updated_at ??
        '';
      return `task_created_assigned:${task.id}:${recipientId}:${assignedAt}`;
    },
  });
}

export async function notifyTaskAssigned(args: {
  taskId: string;
  previousAssigneeIds: string[];
  nextAssigneeIds: string[];
  actor?: NotificationActor | null;
}) {
  const prev = new Set(args.previousAssigneeIds);
  const added = args.nextAssigneeIds.filter((id) => !prev.has(id));
  if (added.length === 0) return;
  await deliverTaskNotification({
    type: 'task_assigned',
    taskId: args.taskId,
    recipientIds: added,
    actor: args.actor,
    dedupeKeyFor: (recipientId, task) => {
      const assignedAt =
        task.assignments.find((a) => a.user_id === recipientId)?.assigned_at ??
        task.updated_at ??
        '';
      return `task_assigned:${task.id}:${recipientId}:${assignedAt}`;
    },
  });
}

export async function notifyTaskCommented(args: {
  taskId: string;
  commentId: string;
  actor?: NotificationActor | null;
  commentPreview?: string | null;
}) {
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_commented',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      comment_id: args.commentId,
      comment_preview: args.commentPreview ?? null,
    },
    dedupeKeyFor: (recipientId) =>
      `task_commented:${args.commentId}:${recipientId}`,
  });
}

export async function notifyTaskScheduleChanged(args: {
  taskId: string;
  before: { scheduled_date: string | null; scheduled_time: string | null };
  after: { scheduled_date: string | null; scheduled_time: string | null };
  actor?: NotificationActor | null;
}) {
  if (
    args.before.scheduled_date === args.after.scheduled_date &&
    args.before.scheduled_time === args.after.scheduled_time
  ) {
    return;
  }
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_schedule_changed',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      before_date: args.before.scheduled_date,
      before_time: args.before.scheduled_time,
      after_date: args.after.scheduled_date,
      after_time: args.after.scheduled_time,
    },
    dedupeKeyFor: (recipientId) =>
      [
        'task_schedule_changed',
        args.taskId,
        recipientId,
        args.before.scheduled_date ?? '',
        args.before.scheduled_time ?? '',
        args.after.scheduled_date ?? '',
        args.after.scheduled_time ?? '',
      ].join(':'),
  });
}

export async function notifyTaskStatusChanged(args: {
  taskId: string;
  beforeStatus: string | null;
  afterStatus: string | null;
  actor?: NotificationActor | null;
}) {
  if (args.beforeStatus === args.afterStatus) return;
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_status_changed',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      before_status: args.beforeStatus,
      after_status: args.afterStatus,
    },
    dedupeKeyFor: (recipientId) =>
      `task_status_changed:${args.taskId}:${recipientId}:${args.beforeStatus ?? ''}:${args.afterStatus ?? ''}:${task.updated_at ?? ''}`,
  });
}

async function getOrgTimezone(supabase: Supabase): Promise<string> {
  try {
    const { data } = await supabase
      .from('operations_settings')
      .select('default_timezone')
      .eq('id', 1)
      .maybeSingle();
    if (typeof data?.default_timezone === 'string' && data.default_timezone) {
      return data.default_timezone;
    }
  } catch {
    // Operations settings may not exist in older environments.
  }
  return DEFAULT_TIMEZONE;
}

export async function runDueTodayNotifications() {
  const supabase = getSupabaseServer();
  const timezone = await getOrgTimezone(supabase);
  const { date } = todayInTz(timezone);

  const { data, error } = await supabase
    .from('turnover_tasks')
    .select(
      `
      id,
      title,
      property_name,
      status,
      scheduled_date,
      scheduled_time,
      updated_at,
      task_assignments(
        user_id,
        assigned_at,
        users(id, name, email)
      )
    `,
    )
    .eq('scheduled_date', date)
    .neq('status', 'complete');

  if (error) {
    throw new Error(error.message);
  }

  const tasks = (data ?? []) as TaskContextRow[];
  let emitted = 0;
  for (const row of tasks) {
    const assignments = (row.task_assignments ?? []).map((a) => a.user_id);
    if (assignments.length === 0) continue;
    await deliverTaskNotification({
      type: 'task_due_today',
      taskId: row.id,
      recipientIds: assignments,
      metadata: { due_date: date, timezone },
      dedupeKeyFor: (recipientId) =>
        `task_due_today:${date}:${row.id}:${recipientId}`,
    });
    emitted += assignments.length;
  }

  return {
    date,
    timezone,
    tasks_scanned: tasks.length,
    recipients_scanned: emitted,
  };
}
