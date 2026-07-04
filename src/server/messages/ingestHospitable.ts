import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchHospitableReservationMessages } from '@/lib/hospitable';
import type { HospitableCreds } from '@/lib/pmsIntegrations';

// Hospitable guest-message ingestion. Upserts a canonical `conversations` row
// (source='hospitable') + the reservation's full message thread. Hospitable's
// message.created webhook fires for BOTH directions, so a single thread pull
// keeps everything in sync. Reservation context (property/guest/dates/channel)
// comes from the already-synced local reservation.

const SOURCE = 'hospitable';

export interface HospitableIngestContext {
  creds: HospitableCreds;
  orgId: string;
}

function str(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

interface HospMessage {
  id: number | string;
  conversation_id?: string;
  body?: string;
  sender_type?: string; // 'guest' | 'host'
  created_at?: string;
}

/** Ingest a reservation's Hospitable message thread. */
export async function ingestHospitableThread(
  ctx: HospitableIngestContext,
  reservationUuid: string,
  opts?: { realtime?: boolean },
): Promise<number> {
  const supabase = getSupabaseServer();

  const messages = (await fetchHospitableReservationMessages(
    ctx.creds,
    reservationUuid,
  )) as HospMessage[];
  if (messages.length === 0) return 0;

  const conversationExternalId = str(messages[0]?.conversation_id) ?? reservationUuid;

  // Reservation context from the locally-synced row (property, guest, dates).
  const { data: resRow } = await supabase
    .from('reservations')
    .select('id, property_id, property_name, guest_name, check_in, check_out, channel')
    .eq('org_id', ctx.orgId)
    .eq('hospitable_reservation_id', reservationUuid)
    .maybeSingle();

  const propertyId = resRow?.property_id ?? null;
  const propertyName = resRow?.property_name ?? null;
  const guestName = resRow?.guest_name ?? null;
  const reservationId = resRow?.id ?? null;
  const channel = resRow?.channel ?? null;
  const checkIn = resRow?.check_in ? String(resRow.check_in).slice(0, 10) : null;
  const checkOut = resRow?.check_out ? String(resRow.check_out).slice(0, 10) : null;

  const ordered = [...messages].sort((a, b) =>
    (str(a.created_at) ?? '').localeCompare(str(b.created_at) ?? ''),
  );
  const last = ordered[ordered.length - 1];
  const lastWithText = [...ordered].reverse().find((m) => (m.body ?? '').trim());
  const lastDirection: 'inbound' | 'outbound' =
    last?.sender_type === 'guest' ? 'inbound' : 'outbound';

  // Preserve app_status/unread across re-ingests.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, app_status, unread, message_count')
    .eq('org_id', ctx.orgId)
    .eq('source', SOURCE)
    .eq('external_conversation_id', conversationExternalId)
    .maybeSingle();

  const hasNewInbound =
    !!existing &&
    messages.length > (existing.message_count ?? 0) &&
    lastDirection === 'inbound';
  const appStatus: 'active' | 'complete' = !existing
    ? 'active'
    : hasNewInbound && existing.app_status === 'complete'
      ? 'active'
      : existing.app_status;
  const unread = !existing ? !!opts?.realtime : hasNewInbound ? true : existing.unread;

  const { data: upserted, error: convErr } = await supabase
    .from('conversations')
    .upsert(
      {
        org_id: ctx.orgId,
        source: SOURCE,
        external_conversation_id: conversationExternalId,
        guest_name: guestName,
        property_id: propertyId,
        property_name: propertyName,
        channel,
        reservation_id: reservationId,
        booking_state: 'booked',
        check_in: checkIn,
        check_out: checkOut,
        last_message_at: str(last?.created_at),
        last_direction: lastDirection,
        last_message_preview: (lastWithText?.body ?? '').trim() || '(no text)',
        message_count: messages.length,
        app_status: appStatus,
        unread,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source,external_conversation_id' },
    )
    .select('id')
    .single();
  if (convErr) throw new Error(convErr.message);
  const convId = (upserted as { id: string }).id;

  const msgRows = ordered.map((m) => ({
    org_id: ctx.orgId,
    source: SOURCE,
    external_message_id: String(m.id),
    conversation_id: convId,
    reservation_id: reservationId,
    property_name: propertyName,
    guest_name: guestName,
    direction: (m.sender_type === 'guest' ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
    body: m.body ?? '',
    sent_at: str(m.created_at),
  }));

  const { error: msgErr } = await supabase
    .from('guest_messages')
    .upsert(msgRows, { onConflict: 'org_id,source,external_message_id' });
  if (msgErr) throw new Error(msgErr.message);

  return msgRows.length;
}
