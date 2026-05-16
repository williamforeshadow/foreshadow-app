// Runtime entrypoint for the rebuilt automations engine.
//
// One public function: `runAutomationsForRowChange(entity, op, row)`. Called
// from the mutation paths (e.g. after a reservation insert succeeds) the same
// way notify.ts hooks are. Failures are caught and logged — we never want an
// automation to block a write.
//
// Scope of this commit (matches conditions.ts):
//   - `row_change` triggers on entity='reservation', op='created'.
//   - Conditions: groups of rules (see conditions.ts).
//   - Actions: `slack_message` with channel recipients only.
//   - Variables: `{{this.<field>}}` and `{{this.<oneToOneRelation>.<field>}}`
//     (one level of relation hydration).
//
// Each unsupported piece logs and skips — the goal is "build out" not "blow up."

import { WebClient } from '@slack/web-api';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { ENTITY_SCHEMAS } from '@/lib/automations/entities';
import type {
  Automation,
  AutomationAction,
  AutomationAttachment,
  EntityKey,
  RowChangeKind,
  SlackMessageAction,
} from '@/lib/automations/types';

const ATTACHMENT_BUCKET = 'slack-automation-attachments';
import { summarizeAutomationFromRow } from '@/lib/automations/validate';
import { evaluateConditions } from './conditions';
import { renderTemplate } from './render';
import { withDerivedReservationFields } from './deriveFields';

export interface RunResult {
  automation_id: string;
  ok: boolean;
  skipped?: string;
  error?: string;
  delivered_to?: string[];
}

/**
 * Fire enabled automations matching this row-change event. Returns one
 * RunResult per automation considered. Swallows errors at the per-automation
 * level so a single bad rule can't fail the others.
 */
export async function runAutomationsForRowChange(
  entity: EntityKey,
  op: RowChangeKind,
  row: Record<string, unknown>,
): Promise<RunResult[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('enabled', true)
    .eq('trigger->>kind', 'row_change')
    .eq('trigger->>entity', entity)
    .contains('trigger->on', [op]);

  if (error) {
    console.error('[automations] failed to load automations', error);
    return [];
  }
  const automations = (data ?? []).map(summarizeAutomationFromRow);
  if (automations.length === 0) return [];

  const today = todayYmd();
  const now = new Date().toISOString();
  let hydrated = await hydrateRelations(entity, row);
  if (entity === 'reservation') {
    hydrated = withDerivedReservationFields(hydrated, today);
  }

  const results: RunResult[] = [];
  for (const automation of automations) {
    try {
      results.push(
        await runOneAutomation(automation, entity, op, hydrated, { today, now }),
      );
    } catch (err) {
      console.error('[automations] automation crashed', {
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

async function runOneAutomation(
  automation: Automation,
  entity: EntityKey,
  op: RowChangeKind,
  thisRow: Record<string, unknown>,
  builtins: { today: string; now: string },
): Promise<RunResult> {
  // 1. Property scope filter. Empty = applies to all properties.
  if (automation.property_ids.length > 0) {
    const propertyId = thisRow.property_id as string | undefined;
    if (!propertyId || !automation.property_ids.includes(propertyId)) {
      return { automation_id: automation.id, ok: true, skipped: 'property scope' };
    }
  }

  // 2. Conditions.
  const passes = evaluateConditions(automation.conditions, {
    this: thisRow,
    today: builtins.today,
    now: builtins.now,
  });
  if (!passes) {
    return { automation_id: automation.id, ok: true, skipped: 'conditions' };
  }

  // 3. Dedup. signature is `<op>:<rowId>` for row_change events. If the
  // same (automation, signature, channel) tuple already delivered we
  // bail — protects against double-fire on retry or duplicate webhooks.
  const rowId = String(thisRow.id ?? '');
  const signature = `${op}:${rowId}`;

  // 4. Actions.
  const delivered: string[] = [];
  for (const action of automation.actions) {
    if (action.kind !== 'slack_message') {
      console.warn(`[automations] action kind "${action.kind}" not implemented yet — skipping`);
      continue;
    }
    const channels = channelRecipients(action);
    if (channels.length === 0) {
      console.warn(`[automations] action ${action.id} has no channel recipients — skipping`);
      continue;
    }
    const message = renderTemplate(action.message_template, {
      this: thisRow,
      builtins,
    });
    if (!message.trim()) {
      console.warn(`[automations] action ${action.id} rendered to empty — skipping`);
      continue;
    }
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

  return { automation_id: automation.id, ok: true, delivered_to: delivered };
}

function channelRecipients(action: SlackMessageAction) {
  const out: Array<{ channel_id: string; channel_name: string }> = [];
  for (const recipient of action.recipients ?? []) {
    if (recipient.kind !== 'channel') {
      console.warn(
        `[automations] recipient kind "${recipient.kind}" not implemented yet — skipping`,
      );
      continue;
    }
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
    console.error('[automations] SLACK_BOT_TOKEN not configured — skipping send');
    return false;
  }
  const web = new WebClient(token);

  // No attachments: simple text post.
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
      console.error('[automations] chat.postMessage failed', {
        channel,
        error: err instanceof Error ? err.message : err,
      });
      return false;
    }
  }

  // With attachments: download bytes from Supabase Storage, then upload via
  // files.uploadV2. Slack combines them into a single message using
  // `initial_comment` as the message body.
  try {
    const fileBuffers = await Promise.all(
      attachments.map(async (a) => {
        const bytes = await downloadAttachment(a.storage_path);
        if (!bytes) return null;
        return { file: bytes, filename: a.name };
      }),
    );
    const goodFiles = fileBuffers.filter(
      (f): f is { file: Buffer; filename: string } => f !== null,
    );
    if (goodFiles.length === 0) {
      console.error('[automations] all attachment downloads failed — falling back to text-only post');
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
    console.error('[automations] filesUploadV2 failed', {
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
    if (error || !data) {
      console.error('[automations] attachment download failed', { storagePath, error });
      return null;
    }
    const arrayBuf = await data.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error('[automations] attachment download threw', { storagePath, err });
    return null;
  }
}

/**
 * Try to claim a delivery slot. Returns true if we are responsible for
 * sending, false if someone else already did (unique violation).
 */
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
  // 23505 = unique_violation. Anything else we treat as a soft failure but
  // still skip the send to avoid double-firing on transient DB errors.
  if (error.code === '23505') return false;
  console.warn('[automations] claimDelivery error', error);
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

/**
 * Fetch one-to-one relations declared in `entities.ts` and attach them under
 * the relation key so `{{this.property.name}}` works. Failures degrade
 * silently — `{{this.property.name}}` simply renders as `{{this.property.name}}`
 * rather than crashing the send.
 */
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
      const { data, error } = await supabase
        .from(target.table)
        .select('*')
        .eq(relation.foreign_field ?? 'id', fk)
        .maybeSingle();
      if (error) {
        console.warn(`[automations] hydrate ${relation.key} failed`, error);
        continue;
      }
      if (data) out[relation.key] = data;
    } catch (err) {
      console.warn(`[automations] hydrate ${relation.key} threw`, err);
    }
  }
  return out;
}

function todayYmd(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Test-fire helper for the editor's "Test" button. Renders + posts the
 * automation against the given sample row, bypassing the conditions and
 * dedup. Returns per-action results so the UI can show which channel(s)
 * received the message.
 */
export async function testFireAutomation(
  automationId: string,
  sampleRow: Record<string, unknown>,
): Promise<RunResult> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('id', automationId)
    .single();
  if (error || !data) {
    return {
      automation_id: automationId,
      ok: false,
      error: error?.message ?? 'automation not found',
    };
  }
  const automation = summarizeAutomationFromRow(data);
  const entity = (automation.trigger.kind === 'row_change'
    ? automation.trigger.entity
    : automation.trigger.for_each?.entity) as EntityKey | undefined;
  if (!entity) {
    return {
      automation_id: automationId,
      ok: false,
      error: 'automation has no scope entity to test against',
    };
  }

  const builtins = { today: todayYmd(), now: new Date().toISOString() };
  let hydrated = await hydrateRelations(entity, sampleRow);
  if (entity === 'reservation') {
    hydrated = withDerivedReservationFields(hydrated, builtins.today);
  }
  const delivered: string[] = [];

  for (const action of automation.actions as AutomationAction[]) {
    if (action.kind !== 'slack_message') continue;
    const channels = channelRecipients(action);
    if (channels.length === 0) continue;
    const message = renderTemplate(action.message_template, {
      this: hydrated,
      builtins,
    });
    if (!message.trim()) continue;
    for (const { channel_id, channel_name } of channels) {
      const ok = await postToChannel(
        channel_id || channel_name,
        `[TEST] ${message}`,
        action.attachments ?? [],
      );
      if (ok) delivered.push(channel_name || channel_id);
    }
  }

  return { automation_id: automationId, ok: true, delivered_to: delivered };
}
