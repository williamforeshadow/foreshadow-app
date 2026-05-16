// Scheduled-automation runtime.
//
// Called once per cron tick (hourly). Loads enabled `kind: 'schedule'`
// automations, decides which ones are due this hour in their resolved
// timezone, and fires them. When `trigger.for_each` is set we iterate rows
// of that entity (reservations only for v2.1), apply conditions per row,
// and post.
//
// v2.1 deliberate limits (each is a small follow-up):
//   - cron granularity is hourly; minute-precision times fire at the top
//     of the next hour
//   - schedule.interval > 1 is ignored
//   - only `reservation` is supported as a `for_each` entity
//   - dedup signature includes the local date + scheduled HH:MM + row id,
//     so re-running the cron in the same hour is idempotent
//
// Errors per automation are caught and logged — one bad rule must not
// block the others.

import { WebClient } from '@slack/web-api';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { ENTITY_SCHEMAS } from '@/lib/automations/entities';
import type {
  Automation,
  AutomationAttachment,
  EntityKey,
  ScheduleConfig,
  SlackMessageAction,
} from '@/lib/automations/types';
import { summarizeAutomationFromRow } from '@/lib/automations/validate';
import { evaluateConditions } from './conditions';
import { renderTemplate } from './render';
import { withDerivedReservationFields } from './deriveFields';

const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const ATTACHMENT_BUCKET = 'slack-automation-attachments';

export interface ScheduleRunResult {
  automation_id: string;
  ok: boolean;
  due?: boolean;
  skipped?: string;
  error?: string;
  delivered_to?: string[];
  rows_considered?: number;
  rows_matched?: number;
}

export async function runScheduleTick(now: Date = new Date()): Promise<ScheduleRunResult[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('enabled', true)
    .eq('trigger->>kind', 'schedule');

  if (error) {
    console.error('[automations:schedule] failed to load automations', error);
    return [];
  }
  const automations = (data ?? []).map(summarizeAutomationFromRow);
  if (automations.length === 0) return [];

  const companyTz = await loadCompanyTimezone();
  const results: ScheduleRunResult[] = [];
  for (const automation of automations) {
    try {
      results.push(await runOneSchedule(automation, now, companyTz));
    } catch (err) {
      console.error('[automations:schedule] automation crashed', {
        id: automation.id,
        error: err,
      });
      results.push({
        automation_id: automation.id,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
  return results;
}

async function runOneSchedule(
  automation: Automation,
  now: Date,
  companyTz: string,
): Promise<ScheduleRunResult> {
  if (automation.trigger.kind !== 'schedule') {
    return { automation_id: automation.id, ok: true, skipped: 'not schedule' };
  }
  const { schedule, for_each } = automation.trigger;
  // No iteration → fire once with no row context. Useful for org-wide
  // digests later; not the focus of v2.1.
  const tz =
    schedule.timezone === 'property' && for_each
      ? null // resolved per-row inside the loop
      : companyTz;

  // For the "fire once" case we need a deterministic TZ. Default to company.
  const baseTz = tz ?? companyTz;
  const baseParts = getZonedParts(now, baseTz);
  const baseDue = isScheduleDue(schedule, baseParts);

  // No for_each: simple fire-once-per-tick path.
  if (!for_each) {
    if (!baseDue) {
      return { automation_id: automation.id, ok: true, due: false };
    }
    const signature = `schedule:${baseParts.dateKey}:${schedule.time}`;
    const delivered = await fireActions(automation, signature, null, {
      today: baseParts.dateKey,
      now: now.toISOString(),
    });
    return { automation_id: automation.id, ok: true, due: true, delivered_to: delivered };
  }

  // for_each iteration. v2.1 supports `reservation` only.
  if (for_each.entity !== 'reservation') {
    console.warn(
      `[automations:schedule] for_each.entity "${for_each.entity}" not implemented yet — skipping`,
    );
    return { automation_id: automation.id, ok: true, skipped: 'for_each entity unsupported' };
  }
  if (automation.property_ids.length === 0 && schedule.timezone === 'company' && !baseDue) {
    // Cheap pre-filter: if company TZ says we're not due and we're not
    // dispatching per-property TZ, skip the row query entirely.
    return { automation_id: automation.id, ok: true, due: false, rows_considered: 0 };
  }

  const supabase = getSupabaseServer();
  let query = supabase.from('reservations').select('*');
  if (automation.property_ids.length > 0) {
    query = query.in('property_id', automation.property_ids);
  }
  const { data: rows, error } = await query;
  if (error) {
    console.error('[automations:schedule] reservations fetch failed', error);
    return { automation_id: automation.id, ok: false, error: error.message };
  }

  let matched = 0;
  const delivered: string[] = [];
  for (const row of (rows ?? []) as Record<string, unknown>[]) {
    // Resolve TZ per row when schedule.timezone === 'property'.
    let rowTz = baseTz;
    if (schedule.timezone === 'property') {
      const propTz = await resolvePropertyTz(row.property_id as string | null);
      if (propTz) rowTz = propTz;
    }
    const rowParts = getZonedParts(now, rowTz);
    if (!isScheduleDue(schedule, rowParts)) continue;

    const hydrated = withDerivedReservationFields(
      await hydrateRelations('reservation', row),
      rowParts.dateKey,
    );
    const passes = evaluateConditions(automation.conditions, {
      this: hydrated,
      today: rowParts.dateKey,
      now: now.toISOString(),
    });
    if (!passes) continue;
    matched += 1;

    const rowId = String(hydrated.id ?? '');
    const signature = `schedule:${rowParts.dateKey}:${schedule.time}:${rowId}`;
    const fired = await fireActions(automation, signature, hydrated, {
      today: rowParts.dateKey,
      now: now.toISOString(),
    });
    for (const c of fired) delivered.push(c);
  }

  return {
    automation_id: automation.id,
    ok: true,
    due: true,
    rows_considered: rows?.length ?? 0,
    rows_matched: matched,
    delivered_to: delivered,
  };
}

// ─── Firing the action set ────────────────────────────────────────────

async function fireActions(
  automation: Automation,
  signature: string,
  thisRow: Record<string, unknown> | null,
  builtins: { today: string; now: string },
): Promise<string[]> {
  const delivered: string[] = [];
  for (const action of automation.actions) {
    if (action.kind !== 'slack_message') continue;
    const channels = channelRecipients(action);
    if (channels.length === 0) continue;
    const message = renderTemplate(action.message_template, {
      this: thisRow,
      builtins,
    });
    if (!message.trim()) continue;
    for (const { channel_id, channel_name } of channels) {
      const recipientKey = `channel:${channel_id || channel_name}`;
      const claim = await claimDelivery(automation.id, signature, recipientKey);
      if (!claim) {
        delivered.push(`${channel_name} (dedup)`);
        continue;
      }
      const ok = await postToChannel(
        channel_id || channel_name,
        message,
        action.attachments ?? [],
      );
      if (ok) delivered.push(channel_name || channel_id);
      else await releaseDelivery(automation.id, signature, recipientKey);
    }
  }
  return delivered;
}

function channelRecipients(action: SlackMessageAction) {
  const out: Array<{ channel_id: string; channel_name: string }> = [];
  for (const recipient of action.recipients ?? []) {
    if (recipient.kind !== 'channel') continue;
    if (!recipient.channel_id && !recipient.channel_name) continue;
    out.push({
      channel_id: recipient.channel_id,
      channel_name: recipient.channel_name,
    });
  }
  return out;
}

async function postToChannel(
  channel: string,
  text: string,
  attachments: AutomationAttachment[],
): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('[automations:schedule] SLACK_BOT_TOKEN not configured');
    return false;
  }
  const web = new WebClient(token);
  if (attachments.length === 0) {
    try {
      await web.chat.postMessage({
        channel,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
      return true;
    } catch (err) {
      console.error('[automations:schedule] chat.postMessage failed', {
        channel,
        error: err instanceof Error ? err.message : err,
      });
      return false;
    }
  }
  try {
    const fileBuffers = await Promise.all(
      attachments.map(async (a) => {
        const bytes = await downloadAttachment(a.storage_path);
        return bytes ? { file: bytes, filename: a.name } : null;
      }),
    );
    const goodFiles = fileBuffers.filter(
      (f): f is { file: Buffer; filename: string } => f !== null,
    );
    if (goodFiles.length === 0) {
      await web.chat.postMessage({ channel, text, unfurl_links: false, unfurl_media: false });
      return true;
    }
    await web.filesUploadV2({
      channel_id: channel,
      initial_comment: text,
      file_uploads: goodFiles,
    });
    return true;
  } catch (err) {
    console.error('[automations:schedule] filesUploadV2 failed', {
      channel,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

async function downloadAttachment(storagePath: string): Promise<Buffer | null> {
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

async function claimDelivery(
  automationId: string,
  signature: string,
  recipientKey: string,
): Promise<boolean> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.from('automation_deliveries').insert({
    automation_id: automationId,
    event_signature: signature,
    recipient_key: recipientKey,
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  console.warn('[automations:schedule] claimDelivery error', error);
  return false;
}

async function releaseDelivery(
  automationId: string,
  signature: string,
  recipientKey: string,
): Promise<void> {
  const supabase = getSupabaseServer();
  await supabase
    .from('automation_deliveries')
    .delete()
    .match({
      automation_id: automationId,
      event_signature: signature,
      recipient_key: recipientKey,
    });
}

// ─── Schedule due-ness ────────────────────────────────────────────────

interface ZonedParts {
  /** YYYY-MM-DD in the resolved timezone. Used as the today/dedup-date key. */
  dateKey: string;
  /** 0–23 in the resolved timezone. */
  hour: number;
  /** 0–6 (Sun–Sat) in the resolved timezone. */
  weekday: number;
  /** 1–31 day of month in the resolved timezone. */
  day: number;
}

function getZonedParts(now: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const weekdayName = get('weekday');
  const hourRaw = get('hour');
  // Intl can emit "24" for midnight in some locales; normalize.
  const hour = Number(hourRaw) === 24 ? 0 : Number(hourRaw);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    weekday: weekdayMap[weekdayName] ?? 0,
    day: Number(day),
  };
}

function isScheduleDue(schedule: ScheduleConfig, parts: ZonedParts): boolean {
  const targetHour = Number(schedule.time?.slice(0, 2) ?? '0');
  if (schedule.frequency === 'hour') return true;
  if (parts.hour !== targetHour) return false;

  if (schedule.frequency === 'day') return true;
  if (schedule.frequency === 'week') {
    return (schedule.weekdays ?? []).includes(parts.weekday);
  }
  if (schedule.frequency === 'month') {
    return (schedule.month_days ?? []).includes(parts.day);
  }
  return false;
}

// ─── Helpers shared with the row-change runtime ───────────────────────

async function hydrateRelations(
  entity: EntityKey,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const schema = ENTITY_SCHEMAS[entity];
  if (!schema || schema.relations.length === 0) return row;
  const supabase = getSupabaseServer();
  const out: Record<string, unknown> = { ...row };
  for (const relation of schema.relations) {
    if (relation.cardinality !== 'one') continue;
    const fk = row[relation.local_field] as string | undefined;
    if (!fk) continue;
    const target = ENTITY_SCHEMAS[relation.target];
    if (!target) continue;
    try {
      const { data } = await supabase
        .from(target.table)
        .select('*')
        .eq(relation.foreign_field ?? 'id', fk)
        .maybeSingle();
      if (data) out[relation.key] = data;
    } catch {
      // best effort
    }
  }
  return out;
}

async function loadCompanyTimezone(): Promise<string> {
  try {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from('operations_settings')
      .select('default_timezone')
      .eq('id', 1)
      .maybeSingle();
    return (data?.default_timezone as string | undefined) || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

async function resolvePropertyTz(propertyId: string | null): Promise<string | null> {
  if (!propertyId) return null;
  try {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from('properties')
      .select('timezone')
      .eq('id', propertyId)
      .maybeSingle();
    return (data?.timezone as string | undefined) || null;
  } catch {
    return null;
  }
}
