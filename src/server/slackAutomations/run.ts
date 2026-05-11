import { WebClient } from '@slack/web-api';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { taskUrl } from '@/src/lib/links';
import { lookupSlackUserByEmail } from '@/src/slack/identity';
import type {
  SlackAutomation,
  SlackAutomationTrigger,
  SlackAutomationConfig,
  SlackAutomationAttachment,
  SlackAutomationDeliveryType,
} from '@/lib/types';
import { buildReservationVariables, renderTemplate } from './render';

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
  skipped_reason?: 'duplicate' | 'no_channel' | 'no_message';
}

export interface ReservationContext {
  id: string;
  property_id: string | null;
  property_name: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
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
  const variables = buildReservationVariables({
    property_name: reservation.property_name,
    guest_name: reservation.guest_name,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    trigger_date: triggerDate,
    default_check_in_time: opSettings.default_check_in_time,
    default_check_out_time: opSettings.default_check_out_time,
  });

  const results: SlackAutomationFireResult[] = [];

  for (const automation of matchingAutomations) {
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
      const result = await fireOneTaskAssignmentAutomation({
        supabase,
        web,
        automation,
        taskId: args.taskId,
        assignee,
        variables,
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
    .select('id, property_id, property_name, guest_name, check_in, check_out')
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
  return {
    actor_name: actor.name ?? '',
    actor_email: actor.email ?? '',
    assignee_name: assignee.name ?? '',
    assignee_email: assignee.email ?? '',
    task_title: task.title || task.template_name || 'Untitled Task',
    task_url: taskUrl(task.id),
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
  const config = automation.config as SlackAutomationConfig | null;

  if (!config?.channel_id) {
    return {
      automation_id: automation.id,
      ok: false,
      skipped_reason: 'no_channel',
      error: 'Automation has no channel configured',
    };
  }

  // Dedup: try the fires-log insert first. If the unique constraint trips
  // it means we already fired this combo and we should skip the Slack call.
  if (!bypassDedup) {
    const { error: dedupErr } = await supabase
      .from('slack_automation_fires')
      .insert({
        automation_id: automation.id,
        reservation_id: reservation.id,
        trigger,
      });

    if (dedupErr) {
      // 23505 = unique_violation in Postgres. PostgREST surfaces it as
      // code "23505" in error.code; on older clients it's in error.details.
      const code = (dedupErr as { code?: string }).code;
      const isDup =
        code === '23505' ||
        /duplicate key/i.test(dedupErr.message ?? '');
      if (isDup) {
        return {
          automation_id: automation.id,
          ok: true,
          skipped_reason: 'duplicate',
        };
      }
      // Anything else (RLS, missing table, etc.) — log and abort. Better
      // to skip than fire-and-lose-track.
      console.error('[slackAutomations/run] dedup insert failed', dedupErr);
      return {
        automation_id: automation.id,
        ok: false,
        error: `dedup log failed: ${dedupErr.message}`,
      };
    }
  }

  // Render the message template against the reservation variables.
  const messageText = renderTemplate(config.message_template ?? '', variables).trim();
  if (!messageText && (config.attachments?.length ?? 0) === 0) {
    // Nothing to say AND nothing to attach — skip.
    return {
      automation_id: automation.id,
      ok: false,
      skipped_reason: 'no_message',
    };
  }

  try {
    const attachments = (config.attachments ?? []) as SlackAutomationAttachment[];

    if (attachments.length === 0) {
      // Plain message path.
      await web.chat.postMessage({
        channel: config.channel_id,
        text: messageText || '(empty message)',
        unfurl_links: false,
        unfurl_media: false,
      });
    } else {
      // Files path — fetch each attachment from Storage as Buffer and
      // hand them to files.uploadV2 along with the message as
      // initial_comment. Slack groups multiple uploads on a single
      // message when they share channel + initial_comment.
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
        channel_id: config.channel_id,
        initial_comment: messageText || undefined,
        file_uploads: fileUploads,
      });
    }

    return { automation_id: automation.id, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[slackAutomations/run] send failed', {
      automation_id: automation.id,
      err: message,
    });

    // Roll back the dedup row so a retry can succeed.
    if (!bypassDedup) {
      await supabase
        .from('slack_automation_fires')
        .delete()
        .eq('automation_id', automation.id)
        .eq('reservation_id', reservation.id)
        .eq('trigger', trigger);
    }

    return { automation_id: automation.id, ok: false, error: message };
  }
}

async function fireOneTaskAssignmentAutomation(args: {
  supabase: ReturnType<typeof getSupabaseServer>;
  web: WebClient;
  automation: SlackAutomation;
  taskId: string;
  assignee: AutomationUserContext;
  variables: Record<string, string>;
}): Promise<TaskAssignmentAutomationResult> {
  const { supabase, web, automation, taskId, assignee, variables } = args;
  const config = automation.config as SlackAutomationConfig | null;
  const deliveryType: SlackAutomationDeliveryType =
    config?.delivery_type ?? 'channel';

  if (!config) {
    return {
      automation_id: automation.id,
      ok: false,
      error: 'Automation has no config',
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  }

  const messageText = renderTemplate(config.message_template ?? '', variables).trim();
  if (!messageText && (config.attachments?.length ?? 0) === 0) {
    return {
      automation_id: automation.id,
      ok: false,
      skipped_reason: 'no_message',
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  }

  const eventSignature = `task_assigned:${taskId}:${assignee.id}`;
  const { error: dedupErr } = await supabase
    .from('slack_automation_deliveries')
    .insert({
      automation_id: automation.id,
      trigger: 'task_assigned',
      entity_type: 'task',
      entity_id: taskId,
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
      event_signature: eventSignature,
    });

  let deliveryLogged = true;
  if (dedupErr) {
    const code = (dedupErr as { code?: string }).code;
    const errorMessage =
      (dedupErr as { message?: string }).message ?? String(dedupErr);
    const isDup =
      code === '23505' || /duplicate key/i.test(errorMessage);
    const isMissingDeliveryTable = await isMissingTaskDeliveryLogTable(
      supabase,
      code,
      errorMessage,
    );
    if (isDup) {
      return {
        automation_id: automation.id,
        ok: true,
        skipped_reason: 'duplicate',
        recipient_user_id: assignee.id,
        recipient_email: assignee.email,
      };
    }
    if (isMissingDeliveryTable) {
      deliveryLogged = false;
      console.warn(
        '[slackAutomations/run] slack_automation_deliveries missing; sending task assignment without dedupe',
      );
    } else {
      console.error('[slackAutomations/run] delivery dedup insert failed', dedupErr);
      return {
        automation_id: automation.id,
        ok: false,
        error: `delivery dedup log failed: ${errorMessage}`,
        recipient_user_id: assignee.id,
        recipient_email: assignee.email,
      };
    }
  }

  try {
    let channelId = config.channel_id;
    if (deliveryType === 'task_assignee_dm') {
      if (!assignee.email) {
        throw new Error(`Assigned user ${assignee.name || assignee.id} has no email for Slack lookup`);
      }
      const slackUser = await lookupSlackUserByEmail(web, assignee.email);
      if (!slackUser?.slackUserId) {
        throw new Error(`No Slack user found for ${assignee.email}`);
      }
      const opened = await web.conversations.open({ users: slackUser.slackUserId });
      const dmChannel = opened.channel?.id;
      if (!dmChannel) {
        throw new Error(`Could not open Slack DM for ${assignee.email}`);
      }
      channelId = dmChannel;
    }

    if (!channelId) {
      throw new Error('Automation has no Slack channel configured');
    }

    await sendAutomationPayload({
      supabase,
      web,
      channelId,
      text: messageText,
      attachments: (config.attachments ?? []) as SlackAutomationAttachment[],
    });

    return {
      automation_id: automation.id,
      ok: true,
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[slackAutomations/run] task assignment send failed', {
      automation_id: automation.id,
      taskId,
      assigneeId: assignee.id,
      err: message,
    });

    if (deliveryLogged) {
      await supabase
        .from('slack_automation_deliveries')
        .delete()
        .eq('automation_id', automation.id)
        .eq('trigger', 'task_assigned')
        .eq('entity_type', 'task')
        .eq('entity_id', taskId)
        .eq('recipient_user_id', assignee.id)
        .eq('event_signature', eventSignature);
    }

    return {
      automation_id: automation.id,
      ok: false,
      error: message,
      recipient_user_id: assignee.id,
      recipient_email: assignee.email,
    };
  }
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
  attachments: SlackAutomationAttachment[];
}): Promise<void> {
  const { supabase, web, channelId, text, attachments } = args;
  if (attachments.length === 0) {
    await web.chat.postMessage({
      channel: channelId,
      text: text || '(empty message)',
      unfurl_links: false,
      unfurl_media: false,
    });
    return;
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
    initial_comment: text || undefined,
    file_uploads: fileUploads,
  });
}
