import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  fetchConversation,
  fetchConversationMessages,
  fetchConversationsList,
} from '@/lib/hostaway';
import { mapHostawayMessagePayload, type RawGuestMessage } from '@/lib/messages';
import { getMapper } from '@/src/server/messages/pms';
import { maybeGenerateSentimentForConversation } from '@/src/server/messages/conversationSentiment';
import type { HostawayCreds } from '@/lib/pmsIntegrations';

// Shared guest-message ingestion. Upserts a canonical `conversations` row (the
// PMS-agnostic anchor for tabs/filters) plus the conversation's full message
// thread (both directions). The webhook only delivers inbound guest messages, so
// host/outbound replies + conversation metadata come from the PMS API here.

// Per-org context (P3): which org's Hostaway integration this ingest runs for.
// creds authenticate the API calls; orgId scopes every DB read/write.
export interface IngestContext {
  creds: HostawayCreds;
  orgId: string;
}

const SOURCE = 'hostaway';

type ExistingConversation = {
  id: string;
  app_status: 'active' | 'complete';
  unread: boolean;
  message_count: number;
};

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function rollup(mapped: RawGuestMessage[]) {
  const when = (m: RawGuestMessage) => m.sentAt ?? '';
  const ordered = [...mapped].sort((a, b) => when(a).localeCompare(when(b)));
  const last = ordered[ordered.length - 1];
  const lastWithText = [...ordered].reverse().find((m) => m.body?.trim());
  return {
    last_message_at: last?.sentAt ?? null,
    last_direction: last?.direction ?? null,
    last_message_preview: lastWithText?.body?.trim() || '(no text)',
    message_count: ordered.length,
    lastIsInbound: last?.direction === 'inbound',
  };
}

/**
 * Recompute a conversation's denormalized "last message" rollup from its stored
 * messages, EXCLUDING any with a future `sent_at` (Hostaway returns scheduled /
 * automated host messages with their future send time — those are not yet sent,
 * so they must never drive the inbox's sort, timestamp, or preview). Compared
 * against the DB clock so it's timezone-correct regardless of the naive strings
 * Hostaway delivers. message_count is intentionally left as the full thread
 * count (scheduled messages still render in the thread, just muted).
 */
async function recomputeSentRollup(
  supabase: ReturnType<typeof getSupabaseServer>,
  convId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('guest_messages')
    .select('sent_at, direction, body')
    .eq('conversation_id', convId)
    .or(`sent_at.is.null,sent_at.lte.${nowIso}`)
    .order('sent_at', { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as {
    sent_at: string | null;
    direction: 'inbound' | 'outbound';
    body: string | null;
  }[];
  if (rows.length === 0) {
    // Only scheduled (future) messages exist — no real activity yet, so the
    // conversation has no "last message" and sorts to the bottom of the inbox.
    await supabase
      .from('conversations')
      .update({
        last_message_at: null,
        last_direction: null,
        last_message_preview: '(no text)',
      })
      .eq('id', convId);
    return;
  }
  const last = rows[0];
  const lastWithText = rows.find((r) => r.body?.trim());
  await supabase
    .from('conversations')
    .update({
      last_message_at: last.sent_at,
      last_direction: last.direction,
      last_message_preview: lastWithText?.body?.trim() || '(no text)',
    })
    .eq('id', convId);
}

/**
 * Ingest one conversation: upsert its canonical row + full message thread.
 * Pass `convObj` (from a list fetch) to skip the per-conversation API call.
 * `opts.realtime` (webhook) makes a brand-new conversation start unread.
 */
export async function ingestConversation(
  ctx: IngestContext,
  conversationId: string | number,
  convObj?: Record<string, unknown> | null,
  opts?: { realtime?: boolean },
): Promise<number> {
  const externalId = String(conversationId);
  const conv = convObj ?? (await fetchConversation(ctx.creds, conversationId));
  const reservation = asObj(conv?.Reservation);

  const raw = await fetchConversationMessages(ctx.creds, conversationId);
  const mapped = raw
    .map(mapHostawayMessagePayload)
    .filter((m): m is RawGuestMessage => m !== null);
  if (mapped.length === 0) return 0;

  const supabase = getSupabaseServer();
  const mapper = getMapper(SOURCE);

  // Canonical metadata from the conversation + its embedded Reservation.
  const guestName = str(conv?.recipientName) ?? str(reservation?.guestName);
  const listingMapId = num(conv?.listingMapId) ?? num(reservation?.listingMapId);
  const reservationHostawayId =
    num(conv?.reservationId) ?? num(reservation?.id);
  const rawStatus = str(reservation?.status);
  const bookingState = mapper.mapBookingState(rawStatus);
  const channel = mapper.mapChannel(str(reservation?.channelName));
  const checkIn = str(reservation?.arrivalDate);
  const checkOut = str(reservation?.departureDate);

  // Resolve local property (by listing) + optional reservation link.
  let propertyId: string | null = null;
  let propertyName: string | null = null;
  if (listingMapId != null) {
    const { data } = await supabase
      .from('properties')
      .select('id, name, hostaway_name')
      .eq('org_id', ctx.orgId)
      .eq('hostaway_listing_id', listingMapId)
      .maybeSingle();
    if (data) {
      propertyId = data.id;
      propertyName = data.hostaway_name ?? data.name ?? null;
    }
  }
  let reservationId: string | null = null;
  if (reservationHostawayId != null) {
    const { data } = await supabase
      .from('reservations')
      .select('id, property_name')
      .eq('org_id', ctx.orgId)
      .eq('hostaway_reservation_id', reservationHostawayId)
      .maybeSingle();
    if (data) {
      reservationId = data.id;
      propertyName = propertyName ?? data.property_name ?? null;
    }
  }

  // Lifecycle (app_status + unread) — read existing first to preserve app state.
  const { data: existingRaw } = await supabase
    .from('conversations')
    .select('id, app_status, unread, message_count')
    .eq('org_id', ctx.orgId)
    .eq('source', SOURCE)
    .eq('external_conversation_id', externalId)
    .maybeSingle();
  const existing = existingRaw as ExistingConversation | null;

  const r = rollup(mapped);
  const hasNewActivity = !existing || r.message_count > existing.message_count;
  const hasNewInbound = !!existing && hasNewActivity && r.lastIsInbound;

  let appStatus: 'active' | 'complete';
  let unread: boolean;
  if (!existing) {
    appStatus = 'active';
    unread = opts?.realtime ? true : false;
  } else {
    appStatus =
      hasNewInbound && existing.app_status === 'complete'
        ? 'active'
        : existing.app_status;
    unread = hasNewInbound ? true : existing.unread;
  }

  const { data: upserted, error: convErr } = await supabase
    .from('conversations')
    .upsert(
      {
        org_id: ctx.orgId,
        source: SOURCE,
        external_conversation_id: externalId,
        guest_name: guestName,
        property_id: propertyId,
        property_name: propertyName,
        channel,
        reservation_id: reservationId,
        booking_state: bookingState,
        check_in: checkIn,
        check_out: checkOut,
        last_message_at: r.last_message_at,
        last_direction: r.last_direction,
        last_message_preview: r.last_message_preview,
        message_count: r.message_count,
        app_status: appStatus,
        unread,
        source_status_raw: rawStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,source,external_conversation_id' },
    )
    .select('id')
    .single();
  if (convErr) throw new Error(convErr.message);
  const convId = (upserted as { id: string }).id;

  // Upsert all messages, linked to the conversation.
  const msgRows = mapped.map((m) => ({
    org_id: ctx.orgId,
    reservation_id: reservationId,
    conversation_id: convId,
    hostaway_conversation_id: m.hostawayConversationId,
    hostaway_message_id: m.hostawayMessageId,
    property_name: propertyName,
    guest_name: guestName,
    direction: m.direction,
    body: m.body,
    sent_at: m.sentAt,
  }));
  const { error: msgErr } = await supabase
    .from('guest_messages')
    .upsert(msgRows, { onConflict: 'org_id,hostaway_message_id' });
  if (msgErr) throw new Error(msgErr.message);

  // The upsert above seeded last_* from the JS rollup, which can't tell future
  // (scheduled) messages from sent ones. Correct it against the DB clock.
  await recomputeSentRollup(supabase, convId);

  // Eager guest-sentiment summary — only on the realtime (webhook) path, so bulk
  // syncs/backfills don't spend a model call per conversation. PMS-agnostic:
  // keyed by the internal conversation id. Best-effort (never throws).
  if (opts?.realtime) await maybeGenerateSentimentForConversation(convId);

  return msgRows.length;
}

/**
 * Fallback for conversations Hostaway no longer returns: build the canonical row
 * from messages already stored locally. booking_state unknown -> inquiry,
 * historical -> read.
 */
async function upsertConversationFromStored(orgId: string, externalId: string): Promise<number> {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from('guest_messages')
    .select('id, hostaway_message_id, guest_name, property_name, reservation_id, direction, body, sent_at, created_at')
    .eq('org_id', orgId)
    .eq('hostaway_conversation_id', externalId);
  const rows = (data ?? []) as Array<{
    id: string;
    guest_name: string | null;
    property_name: string | null;
    reservation_id: string | null;
    direction: 'inbound' | 'outbound';
    body: string;
    sent_at: string | null;
    created_at: string;
  }>;
  if (rows.length === 0) return 0;

  const when = (m: { sent_at: string | null; created_at: string }) =>
    m.sent_at ?? m.created_at ?? '';
  const ordered = [...rows].sort((a, b) => when(a).localeCompare(when(b)));
  const last = ordered[ordered.length - 1];
  const lastWithText = [...ordered].reverse().find((m) => m.body?.trim());

  const { data: upserted, error } = await supabase
    .from('conversations')
    .upsert(
      {
        org_id: orgId,
        source: SOURCE,
        external_conversation_id: externalId,
        guest_name: ordered.find((m) => m.guest_name)?.guest_name ?? null,
        property_name: ordered.find((m) => m.property_name)?.property_name ?? null,
        reservation_id: ordered.find((m) => m.reservation_id)?.reservation_id ?? null,
        booking_state: 'inquiry',
        last_message_at: last.sent_at ?? last.created_at,
        last_direction: last.direction,
        last_message_preview: lastWithText?.body?.trim() || '(no text)',
        message_count: ordered.length,
        app_status: 'active',
        unread: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,source,external_conversation_id' },
    )
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const convId = (upserted as { id: string }).id;

  await supabase
    .from('guest_messages')
    .update({ conversation_id: convId })
    .eq('org_id', orgId)
    .eq('hostaway_conversation_id', externalId);

  // Exclude future (scheduled) messages from the inbox rollup.
  await recomputeSentRollup(supabase, convId);

  return ordered.length;
}

/**
 * Discover + re-sync conversations: Hostaway's recent list (incl. inquiries) plus
 * every conversation we already store. Upserts canonical rows + threads. Used by
 * the cron (capped) and the one-time backfill route (large cap).
 */
export async function backfillRecentConversations(
  ctx: IngestContext,
  max = 80,
): Promise<{ conversations: number; messages: number }> {
  const supabase = getSupabaseServer();

  const summaries = await fetchConversationsList(ctx.creds, 100);
  const targets = new Map<string, Record<string, unknown> | null>();
  for (const c of summaries) {
    const id = str(c.id);
    if (id) targets.set(id, c);
  }

  const { data } = await supabase
    .from('guest_messages')
    .select('hostaway_conversation_id')
    .eq('org_id', ctx.orgId)
    .not('hostaway_conversation_id', 'is', null);
  const known = (data ?? []) as { hostaway_conversation_id: string }[];
  for (const r of known) {
    if (!targets.has(r.hostaway_conversation_id)) {
      targets.set(r.hostaway_conversation_id, null);
    }
  }

  let messages = 0;
  let count = 0;
  for (const [id, convObj] of targets) {
    if (count >= max) break;
    count += 1;
    try {
      messages += await ingestConversation(ctx, id, convObj, { realtime: false });
    } catch {
      // Hostaway may no longer return this conversation — build from stored msgs.
      try {
        messages += await upsertConversationFromStored(ctx.orgId, id);
      } catch (err) {
        console.error('[messages backfill] conversation failed', { id, err });
      }
    }
    await new Promise((res) => setTimeout(res, 700)); // rate-limit friendly
  }

  return { conversations: count, messages };
}
