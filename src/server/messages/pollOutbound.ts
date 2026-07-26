import { getSupabaseServer } from '@/lib/supabaseServer';
import { fetchConversationsList } from '@/lib/hostaway';
import { hostawayDateToUtcIso } from '@/lib/messages';
import { ingestConversation, type IngestContext } from '@/src/server/messages/ingest';

// Outbound change poll — the shim for a webhook Hostaway does not offer.
//
// Hostaway's `message.received` event delivers INBOUND guest messages only.
// A host reply typed in the Hostaway dashboard or app, and every Hostaway
// automation that fires, reaches us through no webhook at all. Before this, such
// a message appeared only when the 30-minute backfill happened to run: the inbox
// showed a thread as awaiting a reply for up to half an hour after it had been
// answered, and — worse — an armed auto-send timer re-validating against our
// local guest_messages could not see that a human had already answered from the
// Hostaway side, and would fire a duplicate reply at the guest.
//
// The cheap fix is that GET /v1/conversations is itself the change signal:
//
//   - every conversation carries `messageSentOn` (last host message) and
//     `messageReceivedOn` (last guest message)
//   - the list comes back sorted by messageSentOn DESC, so outbound activity
//     floats to the top — exactly the axis this poll cares about
//
// So ONE list call per tick tells us which threads moved, and only those get
// pulled. At observed volume (~4 outbound events/hour across ~200 threads) the
// typical tick makes exactly one API call and writes nothing.
//
// This is a shim, and it is built to be deleted. It adds no ingestion path of
// its own — it decides WHICH conversations to hand to the same
// ingestConversation() the webhook uses. If Hostaway ships a sent-message event
// (there is an open request for one), delete the cron and nothing else changes.
//
// SCOPE — outbound is the guarantee; inbound is a bonus. The list's sort key is
// messageSentOn, so a thread that only received a guest message does not float
// up and may fall outside the scan window. Inbound is the webhook's job. We
// still diff messageReceivedOn on the threads we do see, because it costs
// nothing and heals a dropped webhook on the account's most active threads —
// but this is opportunistic repair, not webhook redundancy. Note that a message
// recovered this way syncs WITHOUT the realtime side effects (no Concierge
// draft, no task/knowledge triage, no sentiment) — those belong to the webhook
// path, and inventing them here would let a delivery hiccup silently change what
// the Concierge does hours later.

/** What the tick decided about one conversation in the scan window. */
export interface PollOutcome {
  external_conversation_id: string;
  action: 'ingested' | 'seeded' | 'unchanged' | 'deferred' | 'failed';
  /** Which side moved, when we ingested because something moved. */
  moved?: 'sent' | 'received' | 'both' | 'new';
  error?: string;
}

export interface PollResult {
  scanned: number;
  ingested: number;
  seeded: number;
  deferred: number;
  failed: number;
  outcomes: PollOutcome[];
}

/**
 * How many conversations to look at per tick. The list is sorted by
 * messageSentOn DESC, so the top of it is where outbound change lives — 30 is
 * far more headroom than the observed rate (~4 threads/hour) needs, and costs
 * ~150 KB and ~0.5s. The hourly backfill remains the sweep for everything
 * outside this window.
 */
const SCAN_WINDOW = 30;

/**
 * Ceiling on thread pulls per tick. A burst cap, not a rate limit: the steady
 * state is 0-1 ingests, and this exists so that an unusual moment — a bulk
 * automation blast, a marker column wiped, an account newly connected — costs a
 * bounded number of API calls instead of 30 sequential pulls inside a 60s
 * function. Anything over the cap keeps its markers UNTOUCHED and is therefore
 * picked up by the next tick a minute later; nothing is dropped, only deferred.
 */
const MAX_INGESTS_PER_TICK = 5;

/** Pause between thread pulls, matching the rate-limit courtesy used elsewhere. */
const INGEST_SPACING_MS = 700;

function str(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

/** Is `candidate` strictly newer than the marker we last recorded? */
function moved(candidate: string | null, marker: string | null): boolean {
  if (!candidate) return false;
  if (!marker) return false; // unseeded — handled by the seeding path, not here
  return new Date(candidate).getTime() > new Date(marker).getTime();
}

/**
 * One poll tick for one org: diff the head of the PMS conversation list against
 * our stored activity markers and re-ingest only what actually changed.
 */
export async function pollOutboundChanges(
  ctx: IngestContext,
  opts?: { scan?: number; maxIngests?: number },
): Promise<PollResult> {
  const scan = opts?.scan ?? SCAN_WINDOW;
  const maxIngests = opts?.maxIngests ?? MAX_INGESTS_PER_TICK;
  const supabase = getSupabaseServer();

  const summaries = await fetchConversationsList(ctx.creds, scan);

  // Normalize the window once: external id + both PMS-side timestamps, keeping
  // the raw object so an ingest can skip its own per-conversation fetch.
  const window = summaries
    .map((c) => ({
      externalId: str(c.id),
      sentAt: hostawayDateToUtcIso(str(c.messageSentOn)),
      receivedAt: hostawayDateToUtcIso(str(c.messageReceivedOn)),
      convObj: c,
    }))
    .filter((c): c is typeof c & { externalId: string } => c.externalId !== null);

  // One query for every marker in the window.
  const { data: existingRaw, error: existingErr } = await supabase
    .from('conversations')
    .select('id, external_conversation_id, external_last_sent_at, external_last_received_at')
    .eq('org_id', ctx.orgId)
    .eq('source', 'hostaway')
    .in(
      'external_conversation_id',
      window.map((c) => c.externalId),
    );
  if (existingErr) throw new Error(existingErr.message);

  const markers = new Map(
    ((existingRaw ?? []) as {
      id: string;
      external_conversation_id: string;
      external_last_sent_at: string | null;
      external_last_received_at: string | null;
    }[]).map((r) => [r.external_conversation_id, r]),
  );

  const outcomes: PollOutcome[] = [];
  let ingested = 0;

  for (const c of window) {
    const existing = markers.get(c.externalId);

    // Unknown thread — an inquiry or a brand-new conversation we have never
    // stored. Ingest it: this is the same discovery the backfill does, just an
    // hour sooner.
    if (!existing) {
      if (ingested >= maxIngests) {
        outcomes.push({ external_conversation_id: c.externalId, action: 'deferred' });
        continue;
      }
      const outcome = await ingestOne(ctx, c.externalId, c.convObj, 'new');
      outcomes.push(outcome);
      if (outcome.action === 'ingested') ingested += 1;
      await new Promise((r) => setTimeout(r, INGEST_SPACING_MS));
      continue;
    }

    // Seeding. A thread whose markers are both null predates this poll; the
    // backfill has already synced its contents, we simply have never recorded
    // where it stood. Record that now WITHOUT pulling the thread — the
    // alternative is treating every unseeded row as changed, which would make
    // the first tick after deploy pull the entire scan window at once for no new
    // data. Costs at most one tick of blindness on these threads, and the next
    // real change diffs correctly.
    if (existing.external_last_sent_at === null && existing.external_last_received_at === null) {
      await supabase
        .from('conversations')
        .update({
          external_last_sent_at: c.sentAt,
          external_last_received_at: c.receivedAt,
        })
        .eq('id', existing.id);
      outcomes.push({ external_conversation_id: c.externalId, action: 'seeded' });
      continue;
    }

    const sentMoved = moved(c.sentAt, existing.external_last_sent_at);
    const receivedMoved = moved(c.receivedAt, existing.external_last_received_at);
    if (!sentMoved && !receivedMoved) {
      outcomes.push({ external_conversation_id: c.externalId, action: 'unchanged' });
      continue;
    }

    if (ingested >= maxIngests) {
      // Markers deliberately left alone so the next tick sees this as changed.
      outcomes.push({ external_conversation_id: c.externalId, action: 'deferred' });
      continue;
    }

    const outcome = await ingestOne(
      ctx,
      c.externalId,
      c.convObj,
      sentMoved && receivedMoved ? 'both' : sentMoved ? 'sent' : 'received',
    );
    outcomes.push(outcome);
    if (outcome.action === 'ingested') ingested += 1;
    await new Promise((r) => setTimeout(r, INGEST_SPACING_MS));
  }

  return {
    scanned: window.length,
    ingested,
    seeded: outcomes.filter((o) => o.action === 'seeded').length,
    deferred: outcomes.filter((o) => o.action === 'deferred').length,
    failed: outcomes.filter((o) => o.action === 'failed').length,
    outcomes,
  };
}

/**
 * Pull one changed thread. The markers are NOT written here — ingestConversation
 * writes them from the same conversation object as part of its upsert, so a
 * failed ingest leaves the old marker in place and the thread is retried next
 * tick rather than being marked synced when it wasn't.
 */
async function ingestOne(
  ctx: IngestContext,
  externalId: string,
  convObj: Record<string, unknown>,
  why: NonNullable<PollOutcome['moved']>,
): Promise<PollOutcome> {
  try {
    await ingestConversation(ctx, externalId, convObj, { realtime: false });
    return { external_conversation_id: externalId, action: 'ingested', moved: why };
  } catch (err) {
    console.error('[messages poll] ingest failed', { externalId, err });
    return {
      external_conversation_id: externalId,
      action: 'failed',
      moved: why,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}
