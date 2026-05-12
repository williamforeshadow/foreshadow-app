import { WebClient } from '@slack/web-api';
import type { Block } from '@slack/types';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  SLACK_TRIGGER_LABELS,
  normalizeSlackAutomationConfig,
  slackAutomationMatchesContext,
} from '@/lib/slackAutomationConfig';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { lookupSlackUserByEmail } from '@/src/slack/identity';
import { getTasksByIds } from '@/src/server/tasks/getTaskById';
import type {
  SlackAutomation,
  SlackAutomationTrigger,
  SlackAutomationConfig,
  SlackAutomationAttachment,
  SlackAutomationRecipient,
  SlackAutomationContextType,
} from '@/lib/types';
import { buildReservationVariables } from './render';
import {
  buildSlackTaskLink,
  renderSlackAutomationPayload,
  type TaskCardPayloadContext,
} from './payload';

// Core execution layer for Slack automations.
//
// Two entry points:
//   - runSlackAutomationsForReservation()
//       Fires automations for a single reservation + trigger. Used by:
//         * Hostaway sync hook (new_booking)
//         * Daily cron (check_in / check_out for today)
//         * Manual "Test" button on the editor
//
//   - runSlackAutomationsForTrigger()
//       Sweeps all reservations matching a date for a given trigger and
//       fires their automations. Used by the daily cron.
//
// Dedup: every successful fire is logged to `slack_automation_fires` with a
// unique constraint on (automation_id, reservation_id, trigger). Duplicate
// firings are silently skipped, so the daily cron can run multiple times
// without spamming the channel.
//
// Required SQL (run once in Supabase):
//
//   create table slack_automation_fires (
//     id uuid primary key default gen_random_uuid(),
//     automation_id uuid not null references slack_automations(id) on delete cascade,
//     reservation_id uuid not null,
//     trigger text not null,
//     fired_at timestamptz not null default now(),
//     unique (automation_id, reservation_id, trigger)
//   );
//
//   insert into storage.buckets (id, name, public) values
//     ('slack-automation-attachments', 'slack-automation-attachments', false)
//     on conflict (id) do nothing;

export interface SlackAutomationFireResult {
  automation_id: string;
  ok: boolean;
  error?: string;
  skipped_reason?: 'duplicate' | 'no_channel' | 'no_message' | 'no_recipient';
}

export interface ReservationContext {
  id: string;
  property_id: string | null;
  property_name: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  next_check_in?: string | null;
  property_timezone?: string | null;
}

export interface SlackTaskAssignmentActor {
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface TaskAssignmentAutomationResult extends SlackAutomationFireResult {
  recipient_user_id?: string;
  recipient_email?: string | null;
}

export interface TaskAssignmentAutomationTestResult {
  result: TaskAssignmentAutomationResult;
  used_task: { id: string; title: string | null } | null;
  used_recipient: { id: string; name: string; email: string | null } | null;
}

/**
 * Fire all matching, enabled Slack automations for a single reservation +
 * trigger. Returns a result list (one entry per matched automation), even
 * when individual fires fail or are skipped.
 *
 * `bypassDedup` should be true ONLY for the manual Test button — it lets
 * the user re-test the same automation repeatedly without unique-constraint
 * conflicts and without polluting the production fires log.
 */
export async function runSlackAutomationsForReservation(args: {
  reservation: ReservationContext;
  trigger: SlackAutomationTrigger;
  bypassDedup?: boolean;
}): Promise<SlackAutomationFireResult[]> {
  const { reservation, trigger, bypassDedup } = args;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return [
      {
        automation_id: '',
        ok: false,
        error: 'SLACK_BOT_TOKEN not configured',
      },
    ];
  }

  const supabase = getSupabaseServer();

  // 1. Find matching automations.
  //    A row matches when:
  //      enabled = true
  //      trigger matches
  //      property_ids is empty (= all) OR property_id is in the array
  //
  //    Postgres array overlap with `cs` (contains) handles the second case;
  //    we issue two queries and union the result so the "all properties"
  //    case is captured cleanly.
  const matchingAutomations = await loadMatchingAutomations(
    supabase,
    trigger,
    reservation.property_id,
  );

  if (matchingAutomations.length === 0) {
    return [];
  }

  const web = new WebClient(token);
  const opSettings = await loadOpSettings(supabase);

  // Resolve the property's effective timezone — property override falls back
  // to org default. Used for {{trigger_date}} so "today" matches the
  // property's clock, not whoever's running the cron.
  const propertyTimezone = await resolvePropertyTimezone(
    supabase,
    reservation.property_id,
    opSettings.default_timezone,
  );

  const triggerDate = todayInTz(propertyTimezone).date;
  const variables = {
    ...buildReservationVariables({
    property_name: reservation.property_name,
    guest_name: reservation.guest_name,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    next_check_in: reservation.next_check_in,
    trigger_date: triggerDate,
    default_check_in_time: opSettings.default_check_in_time,
    default_check_out_time: opSettings.default_check_out_time,
    }),
    event_type: trigger,
    event_name: SLACK_TRIGGER_LABELS[trigger] ?? trigger,
    trigger_time: '',
    property_id: reservation.property_id ?? '',
    property_timezone: propertyTimezone,
  };

  const results: SlackAutomationFireResult[] = [];

  for (const automation of matchingAutomations) {
    if (
      !slackAutomationMatchesContext({
        automation,
        propertyId: reservation.property_id,
        variables: variables as unknown as Record<string, string>,
      })
    ) {
      continue;
    }
    const result = await fireOneAutomation({
      supabase,
      web,
      automation,
      reservation,
      trigger,
      variables: variables as unknown as Record<string, string>,
      bypassDedup: !!bypassDedup,
    });
    results.push(result);
  }

  return results;
}

/**
 * Fire task-assignment automations for users newly added to a task.
 *
 * This is deliberately an event hook, not an agent hook: UI writes and
 * Slack-agent writes both call it after the assignment rows are committed.
 * The messages may be delivered through Slack DMs, but no LLM is involved.
 */
export async function runSlackAutomationsForTaskAssignment(args: {
  taskId: string;
  previousAssigneeIds: string[];
  nextAssigneeIds: string[];
  actor?: SlackTaskAssignmentActor | null;
}): Promise<TaskAssignmentAutomationResult[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return [
      {
        automation_id: '',
        ok: false,
        error: 'SLACK_BOT_TOKEN not configured',
      },
    ];
  }

  const previous = new Set(args.previousAssigneeIds);
  const addedAssigneeIds = Array.from(
    new Set(args.nextAssigneeIds.filter((id) => !previous.has(id))),
  );
  if (addedAssigneeIds.length === 0) return [];

  const supabase = getSupabaseServer();
  const task = await loadTaskAssignmentContext(supabase, args.taskId);
  if (!task) {
    return [
      {
        automation_id: '',
        ok: false,
        error: `Task not found: ${args.taskId}`,
      },
    ];
  }

  const matchingAutomations = await loadMatchingAutomations(
    supabase,
    'task_assigned',
    task.property_id,
  );
  if (matchingAutomations.length === 0) return [];

  const users = await loadUsersById(supabase, addedAssigneeIds);
  const actor = await resolveActorForVariables(supabase, args.actor);
  const opSettings = await loadOpSettings(supabase);
  const taskRows = await getTasksByIds([args.taskId]);
  const taskRow = taskRows[0] ?? null;
  const propertyTimezone = await resolvePropertyTimezone(
    supabase,
    task.property_id,
    opSettings.default_timezone,
  );
  const triggerDate = todayInTz(propertyTimezone).date;
  const web = new WebClient(token);
  const results: TaskAssignmentAutomationResult[] = [];

  for (const assigneeId of addedAssigneeIds) {
    const assignee = users.get(assigneeId);
    if (!assignee) {
      results.push({
        automation_id: '',
        ok: false,
        recipient_user_id: assigneeId,
        error: `Assigned user not found: ${assigneeId}`,
      });
      continue;
    }

    const variables = buildTaskAssignmentVariables({
      task,
      actor,
      assignee,
      triggerDate,
    });

    for (const automation of matchingAutomations) {
      if (
        !slackAutomationMatchesContext({
          automation,
          propertyId: task.property_id,
          variables,
        })
      ) {
        continue;
      }
      const result = await fireOneTaskAssignmentAutomation({
        supabase,
        web,
        automation,
        taskId: args.taskId,
        assignee,
        actor,
        variables,
        taskCard: taskRow
          ? { task: taskRow, url: variables.task_url }
          : undefined,
      });
      results.push(result);
    }
  }

  return results;
}

export async function safelyRunSlackAutomationsForTaskAssignment(args: {
  taskId: string;
  previousAssigneeIds: string[];
  nextAssigneeIds: string[];
  actor?: SlackTaskAssignmentActor | null;
  logPrefix: string;
}): Promise<TaskAssignmentAutomationResult[]> {
  const { logPrefix, ...runnerArgs } = args;

  try {
    const results = await runSlackAutomationsForTaskAssignment(runnerArgs);
    const failedResults = results.filter((result) => !result.ok);
    if (failedResults.length > 0) {
      console.error(`${logPrefix} Slack assignment automation failed`, {
        taskId: args.taskId,
        results: failedResults,
      });
    }
    return results;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} Slack assignment automation threw`, {
      taskId: args.taskId,
      err: message,
    });
    return [
      {
        automation_id: '',
        ok: false,
        error: message,
      },
    ];
  }
}

export async function testSlackTaskAssignmentAutomation(args: {
  automation: SlackAutomation;
  taskId?: string;
  recipientUserId?: string;
  actor?: SlackTaskAssignmentActor | null;
}): Promise<TaskAssignmentAutomationTestResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      result: {
        automation_id: args.automation.id,
        ok: false,
        error: 'SLACK_BOT_TOKEN not configured',
      },
      used_task: null,
      used_recipient: null,
    };
  }

  const supabase = getSupabaseServer();
  const sample = await resolveTaskAssignmentTestSample({
    supabase,
    automation: args.automation,
    taskId: args.taskId,
    recipientUserId: args.recipientUserId,
  });
  if (!sample.taskId || !sample.recipientUserId) {
    return {
      result: {
        automation_id: args.automation.id,
        ok: false,
        error: 'Could not find a sample task and recipient to test with.',
      },
      used_task: sample.task,
      used_recipient: null,
    };
  }

  const [task, users, actor, taskRows] = await Promise.all([
    loadTaskAssignmentContext(supabase, sample.taskId),
    loadUsersById(supabase, [sample.recipientUserId]),
    resolveActorForVariables(supabase, args.actor),
    getTasksByIds([sample.taskId]),
  ]);
  const assignee = users.get(sample.recipientUserId);
  if (!task || !assignee) {
    return {
      result: {
        automation_id: args.automation.id,
        ok: false,
        error: !task ? 'Sample task not found.' : 'Sample recipient user not found.',
      },
      used_task: sample.task,
      used_recipient: assignee ?? null,
    };
  }

  const opSettings = await loadOpSettings(supabase);
  const propertyTimezone = await resolvePropertyTimezone(
    supabase,
    task.property_id,
    opSettings.default_timezone,
  );
  const triggerDate = todayInTz(propertyTimezone).date;
  const variables = buildTaskAssignmentVariables({
    task,
    actor,
    assignee,
    triggerDate,
  });
  const web = new WebClient(token);
  const taskRow = taskRows[0] ?? null;
  const result = await fireOneTaskAssignmentAutomation({
    supabase,
    web,
    automation: args.automation,
    taskId: sample.taskId,
    assignee,
    actor,
    variables,
    taskCard: taskRow ? { task: taskRow, url: variables.task_url } : undefined,
    bypassDedup: true,
  });

  return {
    result,
    used_task: sample.task ?? {
      id: sample.taskId,
      title: task.title || task.template_name || 'Untitled Task',
    },
    used_recipient: assignee,
  };
}

/**
 * Sweep every reservation that fires for `trigger` on `dateYYYYMMDD` and
 * run their automations. Used by the daily cron for check_in / check_out.
 *
 * For check_in we look at reservations.check_in = date.
 * For check_out we look at reservations.check_out = date.
 * new_booking is NOT swept here — that one fires inline from the Hostaway
 * sync hook so it can't be expressed as a date sweep.
 */
export async function runSlackAutomationsForTrigger(args: {
  trigger: 'check_in' | 'check_out';
  date: string;
}): Promise<{
  reservationsScanned: number;
  fires: SlackAutomationFireResult[];
}> {
  const { trigger, date } = args;
  const supabase = getSupabaseServer();
  const column = trigger === 'check_in' ? 'check_in' : 'check_out';

  const { data: reservations, error } = await supabase
    .from('reservations')
    .select('id, property_id, property_name, guest_name, check_in, check_out, next_check_in')
    .eq(column, date);

  if (error) {
    return { reservationsScanned: 0, fires: [{ automation_id: '', ok: false, error: error.message }] };
  }

  const all: SlackAutomationFireResult[] = [];
  for (const r of (reservations ?? []) as ReservationContext[]) {
    const fired = await runSlackAutomationsForReservation({
      reservation: r,
      trigger,
    });
    all.push(...fired);
  }

  return { reservationsScanned: reservations?.length ?? 0, fires: all };
}

export async function runScheduledSlackAutomations(args: {
  now?: Date;
  bypassDedup?: boolean;
  bypassSchedule?: boolean;
  automationId?: string;
} = {}): Promise<{
  automationsScanned: number;
  contextsScanned: number;
  fires: SlackAutomationFireResult[];
}> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      automationsScanned: 0,
      contextsScanned: 0,
      fires: [{ automation_id: '', ok: false, error: 'SLACK_BOT_TOKEN not configured' }],
    };
  }

  const supabase = getSupabaseServer();
  let query = supabase
    .from('slack_automations')
    .select('*')
    .eq('enabled', true)
    .eq('trigger', 'scheduled');
  if (args.automationId) {
    query = query.eq('id', args.automationId);
  }
  const { data, error } = await query;
  if (error) {
    return {
      automationsScanned: 0,
      contextsScanned: 0,
      fires: [{ automation_id: '', ok: false, error: error.message }],
    };
  }

  const automations = (data ?? []) as SlackAutomation[];
  const web = new WebClient(token);
  const opSettings = await loadOpSettings(supabase);
  const now = args.now ?? new Date();
  const fires: SlackAutomationFireResult[] = [];
  let contextsScanned = 0;

  for (const automation of automations) {
    const config = normalizeSlackAutomationConfig(automation.config, {
      trigger: 'scheduled',
      property_ids: automation.property_ids ?? [],
    });
    if (config.when?.type !== 'schedule' || !config.when.schedule) continue;
    const schedule = config.when.schedule;
    const contexts = await loadScheduledContexts({
      supabase,
      config,
      automation,
      now,
      companyTimezone: opSettings.default_timezone,
      opSettings,
      bypassSchedule: !!args.bypassSchedule,
    });
    contextsScanned += contexts.length;

    for (const context of contexts) {
      if (
        !slackAutomationMatchesContext({
          automation,
          propertyId: context.propertyId,
          variables: context.variables,
        })
      ) {
        continue;
      }
      const payload = renderSlackAutomationPayload({
        config,
        variables: context.variables,
      });
      const attachments = (config.attachments ?? []) as SlackAutomationAttachment[];
      if (payload.errors.length > 0) {
        fires.push({
          automation_id: automation.id,
          ok: false,
          error: payload.errors.join(' '),
        });
        continue;
      }
      if (!payload.text && !payload.blocks?.length && attachments.length === 0) {
        fires.push({
          automation_id: automation.id,
          ok: false,
          skipped_reason: 'no_message',
        });
        continue;
      }
      fires.push(await sendToResolvedRecipients({
        supabase,
        web,
        automation,
        trigger: 'scheduled',
        entityType: context.entityType,
        entityId: context.entityId,
        eventSignature: `scheduled:${automation.id}:${context.entityType}:${context.entityId}:${context.localDate}:${schedule.time}`,
        recipients: await resolveSlackAutomationRecipients({
          supabase,
          web,
          config,
        }),
        text: payload.text,
        blocks: payload.blocks,
        attachments,
        bypassDedup: !!args.bypassDedup,
      }));
    }
  }

  return {
    automationsScanned: automations.length,
    contextsScanned,
    fires,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────

interface OpSettings {
  default_timezone: string;
  default_check_in_time: string;
  default_check_out_time: string;
}

interface TaskAssignmentTaskContext {
  id: string;
  property_id: string | null;
  property_name: string | null;
  title: string | null;
  template_name: string | null;
  status: string | null;
  priority: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  department_name: string | null;
}

interface AutomationUserContext {
  id: string;
  name: string;
  email: string | null;
}

interface ResolvedSlackAutomationRecipient {
  key: string;
  label: string;
  channelId: string;
  recipient_user_id?: string | null;
  recipient_email?: string | null;
}

interface ScheduledContext {
  entityType: string;
  entityId: string;
  propertyId: string | null;
  localDate: string;
  variables: Record<string, string>;
}

interface PropertyScheduleContext {
  id: string;
  name: string | null;
  timezone: string | null;
}

const FALLBACK_CHECK_IN = '15:00';
const FALLBACK_CHECK_OUT = '11:00';

function trimTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length >= 5 ? value.slice(0, 5) : value;
}

async function loadOpSettings(
  supabase: ReturnType<typeof getSupabaseServer>,
): Promise<OpSettings> {
  try {
    const { data } = await supabase
      .from('operations_settings')
      .select('default_timezone, default_check_in_time, default_check_out_time')
      .eq('id', 1)
      .maybeSingle();
    return {
      default_timezone:
        (data?.default_timezone as string | undefined) || DEFAULT_TIMEZONE,
      default_check_in_time:
        trimTime(data?.default_check_in_time) || FALLBACK_CHECK_IN,
      default_check_out_time:
        trimTime(data?.default_check_out_time) || FALLBACK_CHECK_OUT,
    };
  } catch {
    // table might not exist yet
    return {
      default_timezone: DEFAULT_TIMEZONE,
      default_check_in_time: FALLBACK_CHECK_IN,
      default_check_out_time: FALLBACK_CHECK_OUT,
    };
  }
}

async function resolvePropertyTimezone(
  supabase: ReturnType<typeof getSupabaseServer>,
  propertyId: string | null,
  fallback: string,
): Promise<string> {
  if (!propertyId) return fallback;
  try {
    const { data } = await supabase
      .from('properties')
      .select('timezone')
      .eq('id', propertyId)
      .maybeSingle();
    return (data?.timezone as string | undefined) || fallback;
  } catch {
    return fallback;
  }
}

async function loadScheduledContexts(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
  automation: SlackAutomation;
  now: Date;
  companyTimezone: string;
  opSettings: OpSettings;
  bypassSchedule: boolean;
}): Promise<ScheduledContext[]> {
  const contextType = args.config.context?.type ?? 'reservation_turnover';
  const schedule = args.config.when?.schedule;
  if (!schedule) return [];

  if (schedule.timezone_mode === 'company') {
    const local = localDateTimeParts(args.now, args.companyTimezone);
    if (!args.bypassSchedule && !scheduleIsDue(schedule, local)) return [];
    return loadScheduledContextsForDate({
      ...args,
      contextType,
      localDate: local.date,
      localTime: local.time,
      timezone: args.companyTimezone,
      property: null,
    });
  }

  if (!['reservation_turnover', 'property'].includes(contextType)) {
    const local = localDateTimeParts(args.now, args.companyTimezone);
    if (!args.bypassSchedule && !scheduleIsDue(schedule, local)) return [];
    return loadScheduledContextsForDate({
      ...args,
      contextType,
      localDate: local.date,
      localTime: local.time,
      timezone: args.companyTimezone,
      property: null,
    });
  }

  const properties = await loadScheduleProperties(args.supabase, args.automation);
  const contexts: ScheduledContext[] = [];
  for (const property of properties) {
    const timezone = property.timezone || args.companyTimezone;
    const local = localDateTimeParts(args.now, timezone);
    if (!args.bypassSchedule && !scheduleIsDue(schedule, local)) continue;
    contexts.push(...await loadScheduledContextsForDate({
      ...args,
      contextType,
      localDate: local.date,
      localTime: local.time,
      timezone,
      property,
    }));
  }
  return contexts;
}

async function loadScheduledContextsForDate(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
  automation: SlackAutomation;
  opSettings: OpSettings;
  contextType: SlackAutomationContextType;
  localDate: string;
  localTime: string;
  timezone: string;
  property: PropertyScheduleContext | null;
}): Promise<ScheduledContext[]> {
  switch (args.contextType) {
    case 'reservation_turnover':
      return loadScheduledReservationContexts(args);
    case 'task':
      return loadScheduledTaskContexts(args);
    case 'property':
      return loadScheduledPropertyContexts(args);
    case 'none':
      return [{
        entityType: 'none',
        entityId: '00000000-0000-0000-0000-000000000000',
        propertyId: null,
        localDate: args.localDate,
        variables: {
          event_type: 'scheduled',
          event_name: SLACK_TRIGGER_LABELS.scheduled,
          trigger_date: args.localDate,
          trigger_time: args.localTime,
        },
      }];
    default:
      return [];
  }
}

async function loadScheduledReservationContexts(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  config: SlackAutomationConfig;
  automation: SlackAutomation;
  opSettings: OpSettings;
  localDate: string;
  localTime: string;
  timezone: string;
  property: PropertyScheduleContext | null;
}): Promise<ScheduledContext[]> {
  let query = args.supabase
    .from('reservations')
    .select('id, property_id, property_name, guest_name, check_in, check_out, next_check_in')
    .or(`check_in.eq.${args.localDate},check_out.eq.${args.localDate},next_check_in.eq.${args.localDate}`)
    .limit(200);
  if (args.property?.id) query = query.eq('property_id', args.property.id);
  const { data, error } = await query;
  if (error) {
    console.error('[slackAutomations/run] scheduled reservation lookup failed', error);
    return [];
  }

  return ((data ?? []) as ReservationContext[]).map((reservation) => {
    const variables = {
      ...buildReservationVariables({
        property_name: reservation.property_name,
        guest_name: reservation.guest_name,
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        next_check_in: reservation.next_check_in,
        trigger_date: args.localDate,
        default_check_in_time: args.opSettings.default_check_in_time,
        default_check_out_time: args.opSettings.default_check_out_time,
      }),
      event_type: 'scheduled',
      event_name: SLACK_TRIGGER_LABELS.scheduled,
      trigger_time: args.localTime,
      property_id: reservation.property_id ?? '',
      property_timezone: args.timezone,
    };
    return {
      entityType: 'reservation',
      entityId: reservation.id,
      propertyId: reservation.property_id ?? null,
      localDate: args.localDate,
      variables,
    };
  });
}

async function loadScheduledTaskContexts(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  localDate: string;
  localTime: string;
  property: PropertyScheduleContext | null;
}): Promise<ScheduledContext[]> {
  let query = args.supabase
    .from('turnover_tasks')
    .select('id, property_id, property_name, title, status, priority, scheduled_date, scheduled_time, departments(name)')
    .eq('scheduled_date', args.localDate)
    .limit(200);
  if (args.property?.id) query = query.eq('property_id', args.property.id);
  const { data, error } = await query;
  if (error) {
    console.error('[slackAutomations/run] scheduled task lookup failed', error);
    return [];
  }

  return ((data ?? []) as Array<{
    id: string;
    property_id: string | null;
    property_name: string | null;
    title: string | null;
    status: string | null;
    priority: string | null;
    scheduled_date: string | null;
    scheduled_time: string | null;
    departments: { name: string | null } | null;
  }>).map((task) => ({
    entityType: 'task',
    entityId: task.id,
    propertyId: task.property_id ?? null,
    localDate: args.localDate,
    variables: {
      event_type: 'scheduled',
      event_name: SLACK_TRIGGER_LABELS.scheduled,
      trigger_date: args.localDate,
      trigger_time: args.localTime,
      task_title: task.title ?? 'Untitled Task',
      task_status: task.status ?? '',
      task_priority: task.priority ?? '',
      scheduled_date: task.scheduled_date ?? '',
      scheduled_time: task.scheduled_time ?? '',
      property_id: task.property_id ?? '',
      property_name: task.property_name ?? '',
      department_name: task.departments?.name ?? '',
    },
  }));
}

async function loadScheduledPropertyContexts(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  automation: SlackAutomation;
  localDate: string;
  localTime: string;
  timezone: string;
  property: PropertyScheduleContext | null;
}): Promise<ScheduledContext[]> {
  const properties = args.property
    ? [args.property]
    : await loadScheduleProperties(args.supabase, args.automation);
  return properties.map((property) => ({
    entityType: 'property',
    entityId: property.id,
    propertyId: property.id,
    localDate: args.localDate,
    variables: {
      event_type: 'scheduled',
      event_name: SLACK_TRIGGER_LABELS.scheduled,
      trigger_date: args.localDate,
      trigger_time: args.localTime,
      property_id: property.id,
      property_name: property.name ?? '',
      property_timezone: property.timezone ?? args.timezone,
    },
  }));
}

async function loadScheduleProperties(
  supabase: ReturnType<typeof getSupabaseServer>,
  automation: SlackAutomation,
): Promise<PropertyScheduleContext[]> {
  let query = supabase
    .from('properties')
    .select('id, name, timezone')
    .limit(500);
  if (automation.property_ids?.length) {
    query = query.in('id', automation.property_ids);
  }
  const { data, error } = await query;
  if (error) {
    console.error('[slackAutomations/run] schedule property lookup failed', error);
    return [];
  }
  return (data ?? []) as PropertyScheduleContext[];
}

function localDateTimeParts(
  date: Date,
  timezone: string,
): { date: string; time: string; weekday: number; monthDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const localDate = `${get('year')}-${get('month')}-${get('day')}`;
  const localTime = `${get('hour')}:${get('minute')}`;
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return {
    date: localDate,
    time: localTime,
    weekday,
    monthDay: Number(get('day')) || 1,
  };
}

function scheduleIsDue(
  schedule: NonNullable<SlackAutomationConfig['when']>['schedule'],
  local: { date: string; time: string; weekday: number; monthDay: number },
): boolean {
  if (!schedule) return false;
  if (!timeFallsInPollingWindow(schedule.time, local.time)) return false;
  if (schedule.frequency === 'daily') return true;
  if (schedule.frequency === 'weekly') {
    return schedule.weekdays.length === 0 || schedule.weekdays.includes(local.weekday);
  }
  if (schedule.frequency === 'monthly') {
    return schedule.month_days.length === 0 || schedule.month_days.includes(local.monthDay);
  }
  if (schedule.frequency === 'every_x_days') {
    const epochDays = Math.floor(new Date(`${local.date}T00:00:00Z`).getTime() / 86400000);
    return epochDays % Math.max(1, schedule.interval) === 0;
  }
  return false;
}

function timeFallsInPollingWindow(scheduled: string, actual: string): boolean {
  const scheduledMinutes = timeToMinutes(scheduled);
  const actualMinutes = timeToMinutes(actual);
  if (scheduledMinutes === null || actualMinutes === null) return false;
  const diff = actualMinutes - scheduledMinutes;
  return diff >= 0 && diff < 15;
}

function timeToMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

async function loadTaskAssignmentContext(
  supabase: ReturnType<typeof getSupabaseServer>,
  taskId: string,
): Promise<TaskAssignmentTaskContext | null> {
  const { data, error } = await supabase
    .from('turnover_tasks')
    .select(
      `id, property_id, property_name, title, status, priority,
       scheduled_date, scheduled_time,
       templates(name),
       departments(name)`,
    )
    .eq('id', taskId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[slackAutomations/run] task lookup failed', error);
    return null;
  }
  const row = data as unknown as {
    id: string;
    property_id: string | null;
    property_name: string | null;
    title: string | null;
    status: string | null;
    priority: string | null;
    scheduled_date: string | null;
    scheduled_time: string | null;
    templates: { name: string | null } | null;
    departments: { name: string | null } | null;
  };
  return {
    id: row.id,
    property_id: row.property_id ?? null,
    property_name: row.property_name ?? null,
    title: row.title ?? null,
    template_name: row.templates?.name ?? null,
    status: row.status ?? null,
    priority: row.priority ?? null,
    scheduled_date: row.scheduled_date ?? null,
    scheduled_time: row.scheduled_time ?? null,
    department_name: row.departments?.name ?? null,
  };
}

async function loadUsersById(
  supabase: ReturnType<typeof getSupabaseServer>,
  userIds: string[],
): Promise<Map<string, AutomationUserContext>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email')
    .in('id', userIds);
  if (error) {
    console.error('[slackAutomations/run] user lookup failed', error);
    return new Map();
  }
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string | null; email: string | null }>).map(
      (u) => [
        u.id,
        {
          id: u.id,
          name: u.name ?? '',
          email: u.email ?? null,
        },
      ],
    ),
  );
}

async function resolveActorForVariables(
  supabase: ReturnType<typeof getSupabaseServer>,
  actor: SlackTaskAssignmentActor | null | undefined,
): Promise<AutomationUserContext> {
  if (actor?.user_id) {
    const { data } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('id', actor.user_id)
      .maybeSingle();
    if (data?.id) {
      return {
        id: data.id as string,
        name: (data.name as string | null) ?? actor.name ?? '',
        email: (data.email as string | null) ?? actor.email ?? null,
      };
    }
  }
  return {
    id: actor?.user_id ?? '',
    name: actor?.name ?? '',
    email: actor?.email ?? null,
  };
}

function buildTaskAssignmentVariables(args: {
  task: TaskAssignmentTaskContext;
  actor: AutomationUserContext;
  assignee: AutomationUserContext;
  triggerDate: string;
}): Record<string, string> {
  const { task, actor, assignee, triggerDate } = args;
  const title = task.title || task.template_name || 'Untitled Task';
  const url = taskUrl(task.id);
  return {
    event_type: 'task_assigned',
    event_name: SLACK_TRIGGER_LABELS.task_assigned,
    actor_name: actor.name ?? '',
    actor_email: actor.email ?? '',
    assignee_name: assignee.name ?? '',
    assignee_email: assignee.email ?? '',
    task_title: title,
    task_url: url,
    task_link: buildSlackTaskLink({ url, title }),
    task_status: task.status ?? '',
    task_priority: task.priority ?? '',
    property_name: task.property_name ?? '',
    department_name: task.department_name ?? '',
    scheduled_date: task.scheduled_date ?? '',
    scheduled_time: task.scheduled_time ?? '',
    trigger_date: triggerDate,
  };
}

async function loadMatchingAutomations(
  supabase: ReturnType<typeof getSupabaseServer>,
  trigger: SlackAutomationTrigger,
  propertyId: string | null,
): Promise<SlackAutomation[]> {
  // "all properties" (property_ids = []) and "this property" rules each
  // come back from one query, deduped client-side. property_ids is a
  // text[] column; PostgREST's `cs` filter does array containment.
  const allPropsQuery = supabase
    .from('slack_automations')
    .select('*')
    .eq('enabled', true)
    .eq('trigger', trigger)
    .eq('property_ids', '{}');

  const queries = [allPropsQuery];

  if (propertyId) {
    queries.push(
      supabase
        .from('slack_automations')
        .select('*')
        .eq('enabled', true)
        .eq('trigger', trigger)
        .contains('property_ids', [propertyId]),
    );
  }

  const results = await Promise.all(queries);
  const seen = new Set<string>();
  const automations: SlackAutomation[] = [];

  for (const result of results) {
    if (result.error) {
      console.error('[slackAutomations/run] query failed', result.error);
      continue;
    }
    for (const row of (result.data ?? []) as SlackAutomation[]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        automations.push(row);
      }
    }
  }

  return automations;
}

async function resolveTaskAssignmentTestSample(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  automation: SlackAutomation;
  taskId?: string;
  recipientUserId?: string;
}): Promise<{
  taskId: string | null;
  recipientUserId: string | null;
  task: { id: string; title: string | null } | null;
}> {
  const { supabase, automation, taskId, recipientUserId } = args;

  let selectedTaskId = taskId ?? null;
  let selectedTask: { id: string; title: string | null } | null = null;

  if (!selectedTaskId) {
    let query = supabase
      .from('turnover_tasks')
      .select('id, title, property_id, created_at')
      .order('created_at', { ascending: false })
      .limit(25);

    if (automation.property_ids?.length) {
      query = query.in('property_id', automation.property_ids);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[slackAutomations/run] task assignment test task lookup failed', error);
    }
    const rows = (data ?? []) as Array<{ id: string; title: string | null }>;
    selectedTask = rows[0] ? { id: rows[0].id, title: rows[0].title } : null;
    selectedTaskId = selectedTask?.id ?? null;

    if (!selectedTaskId) {
      return { taskId: null, recipientUserId: null, task: null };
    }

    if (!recipientUserId && rows.length > 0) {
      const { data: assignmentRows } = await supabase
        .from('task_assignments')
        .select('task_id, user_id')
        .in('task_id', rows.map((row) => row.id))
        .limit(1);
      const assignment = (assignmentRows ?? [])[0] as
        | { task_id: string; user_id: string }
        | undefined;
      if (assignment?.task_id) {
        selectedTaskId = assignment.task_id;
        selectedTask =
          rows.find((row) => row.id === assignment.task_id) ?? selectedTask;
      }
      if (assignment?.user_id) {
        return {
          taskId: selectedTaskId,
          recipientUserId: assignment.user_id,
          task: selectedTask,
        };
      }
    }
  }

  if (selectedTaskId && !selectedTask) {
    const { data } = await supabase
      .from('turnover_tasks')
      .select('id, title')
      .eq('id', selectedTaskId)
      .maybeSingle();
    if (data?.id) {
      selectedTask = {
        id: data.id as string,
        title: (data.title as string | null) ?? null,
      };
    }
  }

  if (recipientUserId) {
    return { taskId: selectedTaskId, recipientUserId, task: selectedTask };
  }

  if (selectedTaskId) {
    const { data: assignmentRows } = await supabase
      .from('task_assignments')
      .select('user_id')
      .eq('task_id', selectedTaskId)
      .limit(1);
    const assignment = (assignmentRows ?? [])[0] as
      | { user_id: string }
      | undefined;
    if (assignment?.user_id) {
      return {
        taskId: selectedTaskId,
        recipientUserId: assignment.user_id,
        task: selectedTask,
      };
    }
  }

  const { data: userRows } = await supabase
    .from('users')
    .select('id')
    .not('email', 'is', null)
    .limit(1);
  const fallbackUser = (userRows ?? [])[0] as { id: string } | undefined;
  return {
    taskId: selectedTaskId,
    recipientUserId: fallbackUser?.id ?? null,
    task: selectedTask,
  };
}

async function fireOneAutomation(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  web: WebClient;
  automation: SlackAutomation;
  reservation: ReservationContext;
  trigger: SlackAutomationTrigger;
  variables: Record<string, string>;
  bypassDedup: boolean;
}): Promise<SlackAutomationFireResult> {
  const { supabase, web, automation, reservation, trigger, variables, bypassDedup } = args;
  const config = automation.config
    ? normalizeSlackAutomationConfig(automation.config as SlackAutomationConfig, {
        trigger,
        property_ids: automation.property_ids ?? [],
      })
    : null;
  if (!config) {
    return {
      automation_id: automation.id,
      ok: false,
      error: 'Automation has no config',
    };
  }

  const payload = renderSlackAutomationPayload({ config, variables });
  const attachments = (config.attachments ?? []) as SlackAutomationAttachment[];
  if (payload.errors.length > 0) {
    return {
      automation_id: automation.id,
      ok: false,
      error: payload.errors.join(' '),
    };
  }
  if (!payload.text && !payload.blocks?.length && attachments.length === 0) {
    return {
      automation_id: automation.id,
      ok: false,
      skipped_reason: 'no_message',
    };
  }

  return sendToResolvedRecipients({
    supabase,
    web,
    automation,
    trigger,
    entityType: 'reservation',
    entityId: reservation.id,
    eventSignature: `${trigger}:${reservation.id}`,
    recipients: await resolveSlackAutomationRecipients({
      supabase,
      web,
      config,
    }),
    text: payload.text,
    blocks: payload.blocks,
    attachments,
    bypassDedup,
  });
}

async function fireOneTaskAssignmentAutomation(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  web: WebClient;
  automation: SlackAutomation;
  taskId: string;
  assignee: AutomationUserContext;
  actor: AutomationUserContext;
  variables: Record<string, string>;
  taskCard?: TaskCardPayloadContext;
  bypassDedup?: boolean;
}): Promise<TaskAssignmentAutomationResult> {
  const { supabase, web, automation, taskId, assignee, actor, variables, taskCard, bypassDedup } = args;
  const config = automation.config
    ? normalizeSlackAutomationConfig(automation.config as SlackAutomationConfig, {
        trigger: 'task_assigned',
        property_ids: automation.property_ids ?? [],
      })
    : null;
  if (!config) {
    return {
      automation_id: automation.id,
      ok: false,
      error: 'Automation has no config',
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  }

  const payload = renderSlackAutomationPayload({ config, variables, taskCard });
  const attachments = (config.attachments ?? []) as SlackAutomationAttachment[];
  if (payload.errors.length > 0) {
    return {
      automation_id: automation.id,
      ok: false,
      error: payload.errors.join(' '),
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  }
  if (!payload.text && !payload.blocks?.length && attachments.length === 0) {
    return {
      automation_id: automation.id,
      ok: false,
      skipped_reason: 'no_message',
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  }

  const result = await sendToResolvedRecipients({
    supabase,
    web,
    automation,
    trigger: 'task_assigned',
    entityType: 'task',
    entityId: taskId,
    eventSignature: `task_assigned:${taskId}:${assignee.id}`,
    recipients: await resolveSlackAutomationRecipients({
      supabase,
      web,
      config,
      assignee,
      actor,
    }),
    text: payload.text,
    blocks: payload.blocks,
    attachments,
    bypassDedup: !!bypassDedup,
  });

  return {
    ...result,
    recipient_user_id: assignee.id,
    recipient_email: assignee.email,
  };
}

async function resolveSlackAutomationRecipients(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  web: WebClient;
  config: SlackAutomationConfig;
  assignee?: AutomationUserContext;
  actor?: AutomationUserContext;
}): Promise<ResolvedSlackAutomationRecipient[]> {
  const recipients = args.config.action?.recipients ?? [];
  const resolved: ResolvedSlackAutomationRecipient[] = [];
  const seen = new Set<string>();

  for (const recipient of recipients) {
    let next: ResolvedSlackAutomationRecipient | null = null;
    try {
      next = await resolveSlackAutomationRecipient(args, recipient);
    } catch (err) {
      console.error('[slackAutomations/run] recipient resolution failed', {
        recipient,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!next) continue;
    if (seen.has(next.key)) continue;
    seen.add(next.key);
    resolved.push(next);
  }

  return resolved;
}

async function resolveSlackAutomationRecipient(
  args: {
    supabase: ReturnType<typeof getSupabaseServer>;
    web: WebClient;
    assignee?: AutomationUserContext;
    actor?: AutomationUserContext;
  },
  recipient: SlackAutomationRecipient,
): Promise<ResolvedSlackAutomationRecipient | null> {
  if (recipient.type === 'channel') {
    if (!recipient.channel_id) return null;
    return {
      key: `channel:${recipient.channel_id}`,
      label: recipient.channel_name || recipient.channel_id,
      channelId: recipient.channel_id,
      recipient_user_id: null,
      recipient_email: `channel:${recipient.channel_id}`,
    };
  }

  if (recipient.type === 'user') {
    const user = await loadAutomationUserRecipient(args.supabase, recipient);
    return resolveSlackDmRecipient(args.web, user);
  }

  if (recipient.source === 'task_assignee') {
    return resolveSlackDmRecipient(args.web, args.assignee ?? null);
  }

  if (recipient.source === 'task_actor') {
    return resolveSlackDmRecipient(args.web, args.actor ?? null);
  }

  return null;
}

async function loadAutomationUserRecipient(
  supabase: ReturnType<typeof getSupabaseServer>,
  recipient: Extract<SlackAutomationRecipient, { type: 'user' }>,
): Promise<AutomationUserContext | null> {
  if (!recipient.user_id) return null;
  if (recipient.user_email) {
    return {
      id: recipient.user_id,
      name: recipient.user_name,
      email: recipient.user_email,
    };
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('id', recipient.user_id)
    .maybeSingle();
  if (error || !data?.id) {
    if (error) console.error('[slackAutomations/run] recipient user lookup failed', error);
    return null;
  }
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? recipient.user_name,
    email: (data.email as string | null) ?? null,
  };
}

async function resolveSlackDmRecipient(
  web: WebClient,
  user: AutomationUserContext | null | undefined,
): Promise<ResolvedSlackAutomationRecipient | null> {
  if (!user?.email) return null;
  const slackUser = await lookupSlackUserByEmail(web, user.email);
  if (!slackUser?.slackUserId) return null;
  const opened = await web.conversations.open({ users: slackUser.slackUserId });
  const dmChannel = opened.channel?.id;
  if (!dmChannel) return null;
  return {
    key: `user:${user.id || user.email}`,
    label: user.name || user.email,
    channelId: dmChannel,
    recipient_user_id: user.id || null,
    recipient_email: user.email,
  };
}

async function sendToResolvedRecipients(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  web: WebClient;
  automation: SlackAutomation;
  trigger: SlackAutomationTrigger;
  entityType: string;
  entityId: string;
  eventSignature: string;
  recipients: ResolvedSlackAutomationRecipient[];
  text: string;
  blocks?: Block[];
  attachments: SlackAutomationAttachment[];
  bypassDedup: boolean;
}): Promise<SlackAutomationFireResult> {
  const {
    supabase,
    web,
    automation,
    trigger,
    entityType,
    entityId,
    eventSignature,
    recipients,
    text,
    blocks,
    attachments,
    bypassDedup,
  } = args;

  if (recipients.length === 0) {
    return {
      automation_id: automation.id,
      ok: false,
      skipped_reason: 'no_recipient',
      error: 'Automation has no valid Slack recipients for this event.',
    };
  }

  let sentCount = 0;
  let duplicateCount = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    let deliveryLogged = false;
    if (!bypassDedup) {
      const logResult = await insertSlackAutomationDelivery({
        supabase,
        automationId: automation.id,
        trigger,
        entityType,
        entityId,
        recipient,
        eventSignature,
      });
      if (logResult.duplicate) {
        duplicateCount += 1;
        continue;
      }
      if (!logResult.ok) {
        errors.push(`${recipient.label}: ${logResult.error}`);
        continue;
      }
      deliveryLogged = logResult.logged;
    }

    try {
      await sendAutomationPayload({
        supabase,
        web,
        channelId: recipient.channelId,
        text,
        blocks,
        attachments,
      });
      sentCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${recipient.label}: ${message}`);
      console.error('[slackAutomations/run] recipient send failed', {
        automation_id: automation.id,
        trigger,
        entityType,
        entityId,
        recipient: recipient.key,
        err: message,
      });
      if (deliveryLogged) {
        await deleteSlackAutomationDelivery({
          supabase,
          automationId: automation.id,
          trigger,
          entityType,
          entityId,
          recipient,
          eventSignature,
        });
      }
    }
  }

  if (sentCount > 0) {
    return {
      automation_id: automation.id,
      ok: true,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  if (duplicateCount > 0 && errors.length === 0) {
    return {
      automation_id: automation.id,
      ok: true,
      skipped_reason: 'duplicate',
    };
  }

  return {
    automation_id: automation.id,
    ok: false,
    error: errors.join('; ') || 'No Slack recipients could be sent.',
  };
}

async function insertSlackAutomationDelivery(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  automationId: string;
  trigger: SlackAutomationTrigger;
  entityType: string;
  entityId: string;
  recipient: ResolvedSlackAutomationRecipient;
  eventSignature: string;
}): Promise<{ ok: boolean; logged: boolean; duplicate?: boolean; error?: string }> {
  const {
    supabase,
    automationId,
    trigger,
    entityType,
    entityId,
    recipient,
    eventSignature,
  } = args;

  const existing = await findSlackAutomationDelivery(args);
  if (existing.exists) return { ok: true, logged: false, duplicate: true };
  if (existing.error) return { ok: false, logged: false, error: existing.error };

  const { error } = await supabase
    .from('slack_automation_deliveries')
    .insert({
      automation_id: automationId,
      trigger,
      entity_type: entityType,
      entity_id: entityId,
      recipient_user_id: recipient.recipient_user_id ?? null,
      recipient_email: recipient.recipient_email ?? null,
      event_signature: eventSignature,
    });
  if (!error) return { ok: true, logged: true };

  const code = (error as { code?: string }).code;
  const errorMessage = (error as { message?: string }).message ?? String(error);
  if (code === '23505' || /duplicate key/i.test(errorMessage)) {
    return { ok: true, logged: false, duplicate: true };
  }
  const isMissingDeliveryTable = await isMissingTaskDeliveryLogTable(
    supabase,
    code,
    errorMessage,
  );
  if (isMissingDeliveryTable) {
    console.warn(
      '[slackAutomations/run] slack_automation_deliveries missing; sending without delivery dedupe',
    );
    return { ok: true, logged: false };
  }
  console.error('[slackAutomations/run] delivery dedup insert failed', error);
  return { ok: false, logged: false, error: `delivery dedup log failed: ${errorMessage}` };
}

async function findSlackAutomationDelivery(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  automationId: string;
  trigger: SlackAutomationTrigger;
  entityType: string;
  entityId: string;
  recipient: ResolvedSlackAutomationRecipient;
  eventSignature: string;
}): Promise<{ exists: boolean; error?: string }> {
  const query = args.supabase
    .from('slack_automation_deliveries')
    .select('id')
    .eq('automation_id', args.automationId)
    .eq('trigger', args.trigger)
    .eq('entity_type', args.entityType)
    .eq('entity_id', args.entityId)
    .eq('event_signature', args.eventSignature)
    .limit(1);

  const withUser = args.recipient.recipient_user_id
    ? query.eq('recipient_user_id', args.recipient.recipient_user_id)
    : query.is('recipient_user_id', null);
  const withEmail = args.recipient.recipient_email
    ? withUser.eq('recipient_email', args.recipient.recipient_email)
    : withUser.is('recipient_email', null);
  const { data, error } = await withEmail;

  if (!error) return { exists: (data ?? []).length > 0 };
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? String(error);
  const isMissingDeliveryTable = await isMissingTaskDeliveryLogTable(
    args.supabase,
    code,
    message,
  );
  if (isMissingDeliveryTable) return { exists: false };
  return { exists: false, error: `delivery dedup lookup failed: ${message}` };
}

async function deleteSlackAutomationDelivery(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  automationId: string;
  trigger: SlackAutomationTrigger;
  entityType: string;
  entityId: string;
  recipient: ResolvedSlackAutomationRecipient;
  eventSignature: string;
}): Promise<void> {
  let query = args.supabase
    .from('slack_automation_deliveries')
    .delete()
    .eq('automation_id', args.automationId)
    .eq('trigger', args.trigger)
    .eq('entity_type', args.entityType)
    .eq('entity_id', args.entityId)
    .eq('event_signature', args.eventSignature);
  query = args.recipient.recipient_user_id
    ? query.eq('recipient_user_id', args.recipient.recipient_user_id)
    : query.is('recipient_user_id', null);
  query = args.recipient.recipient_email
    ? query.eq('recipient_email', args.recipient.recipient_email)
    : query.is('recipient_email', null);
  await query;
}

async function isMissingTaskDeliveryLogTable(
  supabase: ReturnType<typeof getSupabaseServer>,
  code: string | undefined,
  message: string,
): Promise<boolean> {
  if (
    code === '42P01' ||
    /relation .*slack_automation_deliveries.* does not exist/i.test(message)
  ) {
    return true;
  }

  const { error } = await supabase
    .from('slack_automation_deliveries')
    .select('id')
    .limit(1);

  if (!error) return false;
  const probeCode = (error as { code?: string }).code;
  const probeMessage = (error as { message?: string }).message ?? String(error);
  return (
    probeCode === '42P01' ||
    /relation .*slack_automation_deliveries.* does not exist/i.test(probeMessage)
  );
}

async function sendAutomationPayload(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  web: WebClient;
  channelId: string;
  text: string;
  blocks?: Block[];
  attachments: SlackAutomationAttachment[];
}): Promise<void> {
  const { supabase, web, channelId, text, blocks, attachments } = args;
  const hasBlocks = (blocks?.length ?? 0) > 0;

  if (hasBlocks || attachments.length === 0) {
    await web.chat.postMessage({
      channel: channelId,
      text: text || '(empty message)',
      ...(hasBlocks ? { blocks } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
    if (attachments.length === 0) return;
  }

  const fileUploads = await Promise.all(
    attachments.map(async (att) => {
      const { data, error } = await supabase.storage
        .from('slack-automation-attachments')
        .download(att.storage_path);
      if (error || !data) {
        throw new Error(
          `Failed to download attachment ${att.name}: ${error?.message ?? 'unknown error'}`,
        );
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      return {
        file: buffer,
        filename: att.name,
      };
    }),
  );

  await web.files.uploadV2({
    channel_id: channelId,
    initial_comment: hasBlocks ? undefined : text || undefined,
    file_uploads: fileUploads,
  });
}
