import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
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
import {
  STATUS_EMOJI,
  STATUS_LABELS as TASK_STATUS_LABELS,
  type SlackCardElement,
  type TaskForUnfurl,
  escapeMrkdwn,
  taskCard,
} from '@/src/slack/unfurlBlocks';

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
  /**
   * Build the Slack Block Kit payload for this notification. The notification
   * id is only known after the row is inserted (or looked up via coalesce),
   * so the renderer returns a builder rather than a finished blocks array —
   * the id is needed for the "Mark as read" button's action_id.
   */
  buildBlocks: (notificationId: string | null) => KnownBlock[];
}

/**
 * Change-event types where rapid edits within a window should coalesce into a
 * single notification (carry forward the original `before_*`, replace the
 * `after_*` with the latest values) instead of creating multiple rows / DMs.
 */
const COALESCABLE_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'task_schedule_changed',
  'task_status_changed',
  'task_priority_changed',
  'task_title_changed',
  'task_description_changed',
  'task_bin_changed',
]);

const COALESCE_WINDOW_MS = 10 * 60 * 1000;

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function statusLabel(status: unknown): string {
  return typeof status === 'string'
    ? TASK_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
    : 'Unknown';
}

function statusEmoji(status: unknown): string {
  return typeof status === 'string' ? STATUS_EMOJI[status] ?? '⚫' : '⚫';
}

function priorityLabel(priority: unknown): string {
  return typeof priority === 'string'
    ? PRIORITY_LABELS[priority] ?? priority.replace(/_/g, ' ')
    : 'Unknown';
}

function formatDate(date: unknown): string | null {
  if (typeof date !== 'string' || !date) return null;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

function formatTime(time: unknown): string | null {
  if (typeof time !== 'string' || !time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return time;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 || 12;
  const minuteText = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${hour12}${minuteText}${suffix}`;
}

function formatSchedule(date: unknown, time: unknown): string {
  const dateText = formatDate(date);
  const timeText = formatTime(time);
  if (dateText && timeText) return `${dateText} at ${timeText}`;
  if (dateText) return dateText;
  if (timeText) return timeText;
  return 'unscheduled';
}

function scheduleSuffix(date: unknown, time: unknown): string {
  const schedule = formatSchedule(date, time);
  return schedule === 'unscheduled' ? '' : ` scheduled for ${schedule}`;
}

function compactPreview(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function descriptionPreview(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return compactPreview(value);
  if (typeof value !== 'object') return null;

  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const typed = node as { text?: unknown; content?: unknown };
    if (typeof typed.text === 'string') parts.push(typed.text);
    if (Array.isArray(typed.content)) typed.content.forEach(visit);
  };
  visit(value);
  return compactPreview(parts.join(' '));
}

function taskLabel(task: TaskContext): string {
  return task.title || 'Untitled task';
}

function actorLabel(actorName: string | null): string {
  return actorName || 'Someone';
}

function quoted(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'Untitled task';
  return `"${text}"`;
}

function taskContextToUnfurl(
  task: TaskContext,
  titleOverride?: string | null,
): TaskForUnfurl {
  return {
    task_id: task.id,
    title: titleOverride ?? task.title,
    template_name: null,
    description: null,
    status: task.status ?? 'not_started',
    priority: '',
    property_name: task.property_name,
    department_name: null,
    bin_name: null,
    scheduled_date: task.scheduled_date,
    scheduled_time: task.scheduled_time,
    assigned_users: [],
    task_url: taskUrl(task.id),
  };
}

interface CarouselBlock {
  type: 'carousel';
  block_id?: string;
  elements: SlackCardElement[];
}

function buildSlackBlocks(args: {
  task: TaskContext;
  actorSentence: string;
  bodyOverride?: string | null;
  titleOverride?: string | null;
  notificationId?: string | null;
}): KnownBlock[] {
  const { task, actorSentence, bodyOverride, titleOverride, notificationId } = args;
  const card = taskCard(taskContextToUnfurl(task, titleOverride), {
    bodyOverride: bodyOverride ?? null,
    markReadNotificationId: notificationId ?? null,
  });
  const carousel: CarouselBlock = {
    type: 'carousel',
    block_id: `task-carousel-${task.id}`,
    elements: [card],
  };

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: actorSentence },
    },
    carousel as unknown as KnownBlock,
  ];
}

function linkTitle(url: string, title: string): string {
  return `<${url}|${escapeMrkdwn(title)}>`;
}

function renderNotification(payload: RenderPayload): RenderedNotification {
  const { type, task, actorName, metadata = {} } = payload;
  const taskName = taskLabel(task);
  const actor = actorLabel(actorName);
  const url = taskUrl(task.id);

  const finalize = (args: {
    title: string;
    body: string;
    actorSentence: string;
    bodyOverride?: string | null;
    titleOverride?: string | null;
  }): RenderedNotification => ({
    title: args.title,
    body: args.body,
    slackText: `${args.title}\n${args.body}\n${url}`,
    buildBlocks: (notificationId: string | null) =>
      buildSlackBlocks({
        task,
        actorSentence: args.actorSentence,
        bodyOverride: args.bodyOverride ?? null,
        titleOverride: args.titleOverride ?? null,
        notificationId,
      }),
  });

  if (type === 'task_created_assigned' || type === 'task_assigned') {
    const title = actorName
      ? `${actor} assigned you ${taskName}`
      : `You've been assigned ${taskName}`;
    const body = `You've been assigned ${taskName}${scheduleSuffix(task.scheduled_date, task.scheduled_time)}.`;
    const verb = type === 'task_created_assigned' ? 'created and assigned' : 'assigned';
    const actorSentence = `${escapeMrkdwn(actor)} ${verb} ${linkTitle(url, taskName)} to you`;
    return finalize({ title, body, actorSentence });
  }

  if (type === 'task_unassigned') {
    const title = actorName
      ? `${actor} unassigned you from ${taskName}`
      : `You've been unassigned from ${taskName}`;
    const body = `${actor} unassigned you from ${taskName}.`;
    const actorSentence = `${escapeMrkdwn(actor)} unassigned you from ${linkTitle(url, taskName)}`;
    return finalize({ title, body, actorSentence });
  }

  if (type === 'task_commented') {
    const preview = compactPreview(metadata.comment_preview);
    const title = `${actor} commented on ${taskName}`;
    const body = preview
      ? `${actor} commented: "${preview}"`
      : `${actor} commented on ${taskName}.`;
    const actorSentence = `${escapeMrkdwn(actor)} commented on ${linkTitle(url, taskName)}`;
    const bodyOverride = preview ? `> ${escapeMrkdwn(preview)}` : null;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  if (type === 'task_schedule_changed') {
    const before = formatSchedule(metadata.before_date, metadata.before_time);
    const after = formatSchedule(metadata.after_date, metadata.after_time);
    const title = `${actor} changed the schedule on your assigned task`;
    const body = `${actor} changed the schedule from ${before} to ${after}.`;
    const actorSentence = `${escapeMrkdwn(actor)} changed the schedule on ${linkTitle(url, taskName)}`;
    const bodyOverride = `~${escapeMrkdwn(before)}~  →  *${escapeMrkdwn(after)}*`;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  if (type === 'task_status_changed') {
    const before = statusLabel(metadata.before_status);
    const after = statusLabel(metadata.after_status);
    const title = `${actor} changed the status of your task`;
    const body = `${actor} changed ${taskName} from ${before} to ${after}.`;
    const actorSentence = `${escapeMrkdwn(actor)} changed the status of ${linkTitle(url, taskName)}`;
    const bodyOverride = `${statusEmoji(metadata.before_status)} ~${escapeMrkdwn(before)}~  →  ${statusEmoji(metadata.after_status)} *${escapeMrkdwn(after)}*`;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  if (type === 'task_bin_changed') {
    const before = typeof metadata.before_bin === 'string' ? metadata.before_bin : 'No bin';
    const after = typeof metadata.after_bin === 'string' ? metadata.after_bin : 'No bin';
    const title = `${actor} moved your task`;
    const body = `${actor} moved ${taskName} from ${before} to ${after}.`;
    const actorSentence = `${escapeMrkdwn(actor)} moved ${linkTitle(url, taskName)}`;
    const bodyOverride = `~${escapeMrkdwn(before)}~  →  *${escapeMrkdwn(after)}*`;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  if (type === 'task_attachment_added') {
    const fileName =
      typeof metadata.file_name === 'string' && metadata.file_name.trim()
        ? metadata.file_name.trim()
        : 'an attachment';
    const title = `${actor} added an attachment to your task`;
    const body = `${actor} added ${fileName} to ${taskName}.`;
    const actorSentence = `${escapeMrkdwn(actor)} added an attachment to ${linkTitle(url, taskName)}`;
    const bodyOverride = `📎 \`${escapeMrkdwn(fileName)}\``;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  if (type === 'task_title_changed') {
    const beforeRaw = typeof metadata.before_title === 'string' && metadata.before_title.trim() ? metadata.before_title.trim() : 'Untitled task';
    const afterRaw = typeof metadata.after_title === 'string' && metadata.after_title.trim() ? metadata.after_title.trim() : 'Untitled task';
    const title = `${actor} changed the title of your task`;
    const body = `${actor} changed ${quoted(metadata.before_title)} to ${quoted(metadata.after_title)}.`;
    const actorSentence = `${escapeMrkdwn(actor)} renamed ${linkTitle(url, afterRaw)}`;
    const bodyOverride = `~"${escapeMrkdwn(beforeRaw)}"~  →  *"${escapeMrkdwn(afterRaw)}"*`;
    return finalize({ title, body, actorSentence, bodyOverride, titleOverride: afterRaw });
  }

  if (type === 'task_priority_changed') {
    const before = priorityLabel(metadata.before_priority);
    const after = priorityLabel(metadata.after_priority);
    const title = `${actor} changed the priority of your task`;
    const body = `${actor} changed ${taskName} from ${before} to ${after}.`;
    const actorSentence = `${escapeMrkdwn(actor)} changed the priority of ${linkTitle(url, taskName)}`;
    const bodyOverride = `~${escapeMrkdwn(before)}~  →  *${escapeMrkdwn(after)}*`;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  if (type === 'task_description_changed') {
    const after = compactPreview(metadata.after_description_preview);
    const title = `${actor} updated the description of your task`;
    const body = `${actor} updated the description for ${taskName}.`;
    const actorSentence = `${escapeMrkdwn(actor)} updated the description of ${linkTitle(url, taskName)}`;
    const bodyOverride = after ? `> ${escapeMrkdwn(after)}` : null;
    return finalize({ title, body, actorSentence, bodyOverride });
  }

  const schedule = formatSchedule(task.scheduled_date, task.scheduled_time);
  const title = `Your task ${taskName} is due today`;
  const body = `${taskName} is scheduled for ${schedule}.`;
  const actorSentence = `${linkTitle(url, taskName)} is due today`;
  return finalize({ title, body, actorSentence });
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

async function binLabel(
  supabase: Supabase,
  binId: string | null,
  isBinned: boolean | null,
): Promise<string> {
  if (!binId) return isBinned ? 'Task Bin' : 'No bin';
  const { data } = await supabase
    .from('project_bins')
    .select('name')
    .eq('id', binId)
    .maybeSingle();
  return typeof data?.name === 'string' && data.name.trim()
    ? data.name
    : 'Unknown bin';
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

async function loadRecipientEmails(
  supabase: Supabase,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const { data, error } = await supabase
    .from('users')
    .select('id, email')
    .in('id', userIds);
  if (error) {
    console.warn('[notifications] recipient email lookup failed', { error });
    return out;
  }
  for (const row of (data ?? []) as Array<{ id: string; email: string | null }>) {
    if (row.email) out.set(row.id, row.email);
  }
  return out;
}

async function sendSlackDm(args: {
  notificationId: string;
  email: string | null;
  text: string;
  blocks: KnownBlock[];
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

    const response = await web.chat.postMessage({
      channel: slackUser.slackUserId,
      text: args.text,
      blocks: args.blocks,
      unfurl_links: false,
      unfurl_media: false,
    });
    await supabase
      .from('notifications')
      .update({
        slack_sent_at: new Date().toISOString(),
        slack_message_ts: typeof response.ts === 'string' ? response.ts : null,
        // Slack returns the DM channel id (Dxxx) in `response.channel`. We
        // need this for chat.update later — Slack rejects user ids (Uxxx)
        // there even though chat.postMessage accepts them.
        slack_channel_id:
          typeof response.channel === 'string' ? response.channel : null,
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

/**
 * Best-effort chat.update for a coalesced notification — if it fails we leave
 * the original Slack DM in place rather than tearing it down; the user will
 * still see the up-to-date in-app notification.
 */
async function updateSlackDm(args: {
  channel: string;
  ts: string;
  text: string;
  blocks: KnownBlock[];
}) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  try {
    const web = new WebClient(token);
    await web.chat.update({
      channel: args.channel,
      ts: args.ts,
      text: args.text,
      blocks: args.blocks,
    });
  } catch (err) {
    console.warn('[notifications] slack update failed', {
      ts: args.ts,
      channel: args.channel,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function mergeCoalesceMetadata(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  // Carry forward `before_*` from the original notification (so the user sees
  // the full delta from where they started), take everything else from the
  // incoming change so `after_*` reflects the latest value.
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (k.startsWith('before_')) continue;
    merged[k] = v;
  }
  return merged;
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
  // Email lookup goes against the users table directly, not task.assignments,
  // so unassigned recipients (no longer in assignments) still get DMs.
  const emails = await loadRecipientEmails(supabase, [...recipientSet]);

  for (const recipientId of recipientSet) {
    const preference = preferenceFor(prefs, recipientId, args.type);
    if (!preference.native_enabled && !preference.slack_enabled) continue;
    const email = emails.get(recipientId) ?? null;

    // Coalesce path: for edit-type notifications, if an unread one already
    // exists for (type, task, recipient, actor) within the window, update it
    // in place and chat.update the existing Slack DM rather than spamming a
    // new row.
    if (COALESCABLE_TYPES.has(args.type)) {
      const windowStart = new Date(Date.now() - COALESCE_WINDOW_MS).toISOString();
      const { data: existing } = await supabase
        .from('notifications')
        .select('id, metadata, slack_message_ts, slack_channel_id')
        .eq('type', args.type)
        .eq('entity_id', task.id)
        .eq('user_id', recipientId)
        .eq('actor_user_id', actorId)
        .is('read_at', null)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const mergedMeta = mergeCoalesceMetadata(
          existing.metadata as Record<string, unknown> | null,
          args.metadata ?? null,
        );
        const renderedMerged = renderNotification({
          type: args.type,
          task,
          actorName,
          metadata: mergedMeta,
        });
        await supabase
          .from('notifications')
          .update({
            title: renderedMerged.title,
            body: renderedMerged.body,
            metadata: mergedMeta,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (
          preference.slack_enabled &&
          typeof existing.slack_message_ts === 'string' &&
          existing.slack_message_ts &&
          typeof existing.slack_channel_id === 'string' &&
          existing.slack_channel_id
        ) {
          await updateSlackDm({
            channel: existing.slack_channel_id,
            ts: existing.slack_message_ts,
            text: renderedMerged.slackText,
            blocks: renderedMerged.buildBlocks(existing.id as string),
          });
        }
        continue;
      }
    }

    const rendered = renderNotification({
      type: args.type,
      task,
      actorName,
      metadata: args.metadata,
    });

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
      const notificationId = data.id as string;
      await sendSlackDm({
        notificationId,
        email,
        text: rendered.slackText,
        blocks: rendered.buildBlocks(notificationId),
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

export async function notifyTaskUnassigned(args: {
  taskId: string;
  previousAssigneeIds: string[];
  nextAssigneeIds: string[];
  actor?: NotificationActor | null;
}) {
  const next = new Set(args.nextAssigneeIds);
  const removed = args.previousAssigneeIds.filter((id) => !next.has(id));
  if (removed.length === 0) return;
  await deliverTaskNotification({
    type: 'task_unassigned',
    taskId: args.taskId,
    recipientIds: removed,
    actor: args.actor,
    dedupeKeyFor: (recipientId, task) =>
      `task_unassigned:${task.id}:${recipientId}:${task.updated_at ?? ''}`,
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

export async function notifyTaskBinChanged(args: {
  taskId: string;
  before: { bin_id: string | null; is_binned: boolean | null };
  after: { bin_id: string | null; is_binned: boolean | null };
  actor?: NotificationActor | null;
}) {
  if (
    args.before.bin_id === args.after.bin_id &&
    args.before.is_binned === args.after.is_binned
  ) {
    return;
  }
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  const [beforeBin, afterBin] = await Promise.all([
    binLabel(supabase, args.before.bin_id, !!args.before.is_binned),
    binLabel(supabase, args.after.bin_id, !!args.after.is_binned),
  ]);
  await deliverTaskNotification({
    type: 'task_bin_changed',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      before_bin_id: args.before.bin_id,
      before_is_binned: args.before.is_binned,
      before_bin: beforeBin,
      after_bin_id: args.after.bin_id,
      after_is_binned: args.after.is_binned,
      after_bin: afterBin,
    },
    dedupeKeyFor: (recipientId, loadedTask) =>
      [
        'task_bin_changed',
        args.taskId,
        recipientId,
        args.before.bin_id ?? '',
        String(args.before.is_binned ?? false),
        args.after.bin_id ?? '',
        String(args.after.is_binned ?? false),
        loadedTask.updated_at ?? '',
      ].join(':'),
  });
}

export async function notifyTaskAttachmentAdded(args: {
  taskId: string;
  attachmentId: string;
  fileName: string;
  actor?: NotificationActor | null;
}) {
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_attachment_added',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      attachment_id: args.attachmentId,
      file_name: args.fileName,
    },
    dedupeKeyFor: (recipientId) =>
      `task_attachment_added:${args.attachmentId}:${recipientId}`,
  });
}

export async function notifyTaskTitleChanged(args: {
  taskId: string;
  beforeTitle: string | null;
  afterTitle: string | null;
  actor?: NotificationActor | null;
}) {
  if ((args.beforeTitle ?? '') === (args.afterTitle ?? '')) return;
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_title_changed',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      before_title: args.beforeTitle,
      after_title: args.afterTitle,
    },
    dedupeKeyFor: (recipientId, loadedTask) =>
      `task_title_changed:${args.taskId}:${recipientId}:${args.beforeTitle ?? ''}:${args.afterTitle ?? ''}:${loadedTask.updated_at ?? ''}`,
  });
}

export async function notifyTaskPriorityChanged(args: {
  taskId: string;
  beforePriority: string | null;
  afterPriority: string | null;
  actor?: NotificationActor | null;
}) {
  if ((args.beforePriority ?? '') === (args.afterPriority ?? '')) return;
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_priority_changed',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      before_priority: args.beforePriority,
      after_priority: args.afterPriority,
    },
    dedupeKeyFor: (recipientId, loadedTask) =>
      `task_priority_changed:${args.taskId}:${recipientId}:${args.beforePriority ?? ''}:${args.afterPriority ?? ''}:${loadedTask.updated_at ?? ''}`,
  });
}

export async function notifyTaskDescriptionChanged(args: {
  taskId: string;
  beforeDescription: unknown;
  afterDescription: unknown;
  actor?: NotificationActor | null;
}) {
  const before = descriptionPreview(args.beforeDescription);
  const after = descriptionPreview(args.afterDescription);
  if ((before ?? '') === (after ?? '')) return;
  const supabase = getSupabaseServer();
  const task = await loadTaskContext(supabase, args.taskId);
  if (!task) return;
  await deliverTaskNotification({
    type: 'task_description_changed',
    taskId: args.taskId,
    recipientIds: task.assignments.map((a) => a.user_id),
    actor: args.actor,
    metadata: {
      before_description_preview: before,
      after_description_preview: after,
    },
    dedupeKeyFor: (recipientId, loadedTask) =>
      `task_description_changed:${args.taskId}:${recipientId}:${before ?? ''}:${after ?? ''}:${loadedTask.updated_at ?? ''}`,
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

/**
 * Mark a notification as read. Idempotent — re-running on an already-read row
 * is a no-op. Used by both the in-app `POST /api/notifications/mark-read`
 * route and the Slack "Mark as read" interactivity handler so behavior stays
 * identical across surfaces.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<{ ok: boolean; alreadyRead: boolean }> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.warn('[notifications] mark read failed', { notificationId, error });
    return { ok: false, alreadyRead: false };
  }
  return { ok: true, alreadyRead: !data };
}

/**
 * Delete the original Slack DM for a notification. Used by the interactivity
 * handler after the user clicks "Mark as read" — the message is gone, leaving
 * the user's Slack DMs clean. The in-app bell still has the row (marked read).
 *
 * Best-effort: if chat.delete fails (e.g. message older than retention, bot
 * lacks scope), we log and leave the message alone — the row is still marked
 * read on the DB side, so the in-app state is correct either way.
 */
export async function deleteNotificationSlackMessage(
  notificationId: string,
): Promise<void> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, slack_message_ts, slack_channel_id')
    .eq('id', notificationId)
    .maybeSingle();
  if (error || !data || !data.slack_message_ts || !data.slack_channel_id) {
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  try {
    const web = new WebClient(token);
    await web.chat.delete({
      channel: data.slack_channel_id,
      ts: data.slack_message_ts,
    });
    // Null the message id so a later coalesce attempt doesn't try to update a
    // deleted message — though that path also gates on read_at IS NULL.
    await supabase
      .from('notifications')
      .update({
        slack_message_ts: null,
        slack_channel_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', notificationId);
  } catch (err) {
    console.warn('[notifications] slack delete failed', {
      notificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Re-render a notification's Slack blocks and `chat.update` the original DM.
 * Used by the interactivity handler after the user clicks "Mark as read" to
 * remove the mark-read button (the ↗ open button stays).
 */
export async function refreshNotificationSlackMessage(
  notificationId: string,
  options?: { includeMarkReadButton?: boolean },
): Promise<void> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, user_id, actor_user_id, entity_id, metadata, slack_message_ts, slack_channel_id')
    .eq('id', notificationId)
    .maybeSingle();
  if (error || !data) return;

  const row = data as {
    id: string;
    type: NotificationType;
    user_id: string;
    actor_user_id: string | null;
    entity_id: string;
    metadata: Record<string, unknown> | null;
    slack_message_ts: string | null;
    slack_channel_id: string | null;
  };
  if (!row.slack_message_ts || !row.slack_channel_id) return;

  const task = await loadTaskContext(supabase, row.entity_id);
  if (!task) return;
  const actorName = await loadActorName(supabase, { user_id: row.actor_user_id });
  const rendered = renderNotification({
    type: row.type,
    task,
    actorName,
    metadata: row.metadata ?? {},
  });
  await updateSlackDm({
    channel: row.slack_channel_id,
    ts: row.slack_message_ts,
    text: rendered.slackText,
    blocks: rendered.buildBlocks(
      options?.includeMarkReadButton === false ? null : row.id,
    ),
  });
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
