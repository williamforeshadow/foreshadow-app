import { WebClient } from '@slack/web-api';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import type {
  SlackAutomation,
  SlackAutomationTrigger,
  SlackAutomationConfig,
  SlackAutomationAttachment,
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
  let propertyTimezone = opSettings.default_timezone;
  if (reservation.property_id) {
    const { data: prop } = await supabase
      .from('properties')
      .select('timezone')
      .eq('id', reservation.property_id)
      .maybeSingle();
    if (prop?.timezone) propertyTimezone = prop.timezone as string;
  }

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
