import type { KnownBlock } from '@slack/types';
import {
  PROPERTY_NOTIFICATION_TYPES,
  type PropertyNotificationType,
} from '@/lib/notifications';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { pushToUser } from '@/src/server/notifications/apns';
import { loadRecipientEmails, sendSlackDm } from './notify';
import { conversationPath, conversationUrl } from '@/src/lib/links';
import { escapeMrkdwn } from '@/src/slack/unfurlBlocks';

// Delivery for the two CONVERSATION-scoped proposal notifications
// ('proposed_task', 'proposed_reply'). These are NOT task/assignee based, so
// they can't go through deliverTaskNotification — recipients are resolved from
// the per-property opt-in table notification_property_preferences. We reuse the
// channel machinery (Slack DM + APNs + the notifications row) but keep the small
// insert here since there's no coalescing and the entity is a conversation.

type Supabase = ReturnType<typeof getSupabaseServer>;

interface PropertyPrefRow {
  user_id: string;
  native_enabled: boolean;
  slack_enabled: boolean;
  push_enabled: boolean;
}

/**
 * Resolve the opt-in recipients for a (property, type) pair. Row presence IS
 * the opt-in (no row → not a recipient); the booleans are channel choices.
 */
async function loadPropertyOptIns(
  supabase: Supabase,
  propertyId: string,
  type: PropertyNotificationType,
): Promise<PropertyPrefRow[]> {
  const { data, error } = await supabase
    .from('notification_property_preferences')
    .select('user_id, native_enabled, slack_enabled, push_enabled')
    .eq('property_id', propertyId)
    .eq('type', type);
  if (error) {
    console.warn('[proposal notify] opt-in lookup failed', { propertyId, type, error });
    return [];
  }
  return (data ?? []) as PropertyPrefRow[];
}

/** Minimal Slack blocks: a sentence + an "Open conversation" button. */
function buildSlackBlocks(args: {
  title: string;
  body: string;
  url: string;
}): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${escapeMrkdwn(args.title)}*\n${escapeMrkdwn(args.body)}` },
    },
  ];
  if (args.url.startsWith('http')) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open conversation' },
          url: args.url,
        },
      ],
    });
  }
  return blocks;
}

interface DeliverArgs {
  type: PropertyNotificationType;
  conversationId: string;
  propertyId: string | null;
  /** The notifications row entity_id (proposed_task.id or the conversation id). */
  entityId: string;
  entityType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /** Build a per-recipient dedupe key so each event notifies once per user. */
  dedupeKeyFor: (recipientId: string) => string;
}

async function deliverConversationNotification(args: DeliverArgs): Promise<void> {
  // No property → can't resolve opt-in recipients. Skip quietly (e.g. a
  // conversation whose reservation/property hasn't synced yet).
  if (!args.propertyId) return;

  const supabase = getSupabaseServer();
  const optIns = await loadPropertyOptIns(supabase, args.propertyId, args.type);
  if (optIns.length === 0) return;

  const recipientIds = optIns.map((r) => r.user_id);
  const emails = await loadRecipientEmails(supabase, recipientIds);
  const href = conversationPath(args.conversationId);
  const absoluteUrl = conversationUrl(args.conversationId);

  for (const pref of optIns) {
    if (!pref.native_enabled && !pref.slack_enabled && !pref.push_enabled) {
      continue;
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: args.type,
        user_id: pref.user_id,
        actor_user_id: null,
        entity_type: args.entityType,
        entity_id: args.entityId,
        title: args.title,
        body: args.body,
        href,
        metadata: args.metadata ?? {},
        native_visible: pref.native_enabled,
        dedupe_key: args.dedupeKeyFor(pref.user_id),
      })
      .select('id')
      .single();

    if (error) {
      // 23505 = already delivered (dedupe_key collision). Expected on retries.
      if (error.code !== '23505') {
        console.warn('[proposal notify] insert failed', {
          type: args.type,
          conversationId: args.conversationId,
          recipientId: pref.user_id,
          error,
        });
      }
      continue;
    }

    const notificationId = data?.id as string | undefined;
    if (!notificationId) continue;

    if (pref.slack_enabled) {
      await sendSlackDm({
        notificationId,
        email: emails.get(pref.user_id) ?? null,
        text: `${args.title}\n${args.body}\n${absoluteUrl}`,
        blocks: buildSlackBlocks({ title: args.title, body: args.body, url: absoluteUrl }),
      });
    }

    if (pref.push_enabled) {
      await pushToUser(pref.user_id, {
        title: args.title,
        body: args.body,
        href,
        notificationId,
      });
    }
  }
}

/**
 * Notify opted-in users that the concierge drafted a TASK for review. dedupeKey
 * is keyed on the proposal id so one notification fires per proposal per user.
 */
export async function notifyProposedTask(args: {
  proposedTaskId: string;
  conversationId: string;
  propertyId: string | null;
  guestName?: string | null;
  propertyName?: string | null;
  title: string;
}): Promise<void> {
  const who = args.guestName ? args.guestName : 'the guest';
  const where = args.propertyName ? ` staying at ${args.propertyName}` : '';
  await deliverConversationNotification({
    type: 'proposed_task',
    conversationId: args.conversationId,
    propertyId: args.propertyId,
    entityId: args.proposedTaskId,
    entityType: 'proposed_task',
    title: `Task Proposal — ${args.title}`,
    body: `View conversation with ${who}${where}`,
    dedupeKeyFor: (recipientId) =>
      `proposed_task:${args.proposedTaskId}:${recipientId}`,
  });
}

/**
 * Notify opted-in users that the concierge drafted a REPLY for review. dedupeKey
 * is keyed on the answered message so regenerations don't re-notify, but a new
 * inbound message (new answers_message_id) does.
 */
export async function notifyProposedReply(args: {
  conversationId: string;
  propertyId: string | null;
  answersMessageId: string | null;
  guestName?: string | null;
  propertyName?: string | null;
}): Promise<void> {
  const who = args.guestName ? args.guestName : 'a guest';
  const where = args.propertyName ? ` staying at ${args.propertyName}` : '';
  await deliverConversationNotification({
    type: 'proposed_reply',
    conversationId: args.conversationId,
    propertyId: args.propertyId,
    entityId: args.conversationId,
    entityType: 'conversation',
    title: `Reply Proposal — ${who}`,
    body: `View conversation with ${who}${where}`,
    dedupeKeyFor: (recipientId) =>
      `proposed_reply:${args.conversationId}:${args.answersMessageId ?? 'none'}:${recipientId}`,
  });
}

/**
 * Notify opted-in users that the concierge suggested a property-knowledge
 * addition from a conversation. One notification per proposal per user.
 */
export async function notifyProposedKnowledge(args: {
  proposedKnowledgeId: string;
  conversationId: string;
  propertyId: string | null;
  propertyName?: string | null;
  summary: string;
}): Promise<void> {
  const title = args.propertyName
    ? `Property Knowledge Proposal — ${args.propertyName}`
    : 'Property Knowledge Proposal';
  await deliverConversationNotification({
    type: 'proposed_knowledge',
    conversationId: args.conversationId,
    propertyId: args.propertyId,
    entityId: args.proposedKnowledgeId,
    entityType: 'proposed_knowledge',
    title,
    body: `Needs approval: ${args.summary}`,
    dedupeKeyFor: (recipientId) =>
      `proposed_knowledge:${args.proposedKnowledgeId}:${recipientId}`,
  });
}

/** Exported for tests / callers that want the raw type guard. */
export function isPropertyNotificationType(
  value: string,
): value is PropertyNotificationType {
  return (PROPERTY_NOTIFICATION_TYPES as readonly string[]).includes(value);
}
