// In-memory event-id dedup with TTL.
//
// Slack retries event delivery up to 3 times when it doesn't get a 200
// within 3 seconds (and it's pretty aggressive about timing — a slow
// LLM call easily blows past 3s). Without dedup, every retry would re-run
// the agent, double-charge for tokens, and post duplicate replies.
//
// The dedup key is `event.event_id` which Slack guarantees is stable
// across retries of the same event but unique across distinct events.
// We hold each id in memory for 10 minutes (well beyond Slack's retry
// window) and let the Map size cap itself naturally — a busy workspace
// might see a few thousand entries at peak, which is trivial.
//
// In-memory is fine because each instance handles its own retries; if
// Slack hits two different instances behind a load balancer, both could
// process the same event once each. For a single-host deployment that's
// a non-issue. If we ever scale horizontally we can swap the Map for a
// Redis SETNX with the same TTL.

const TTL_MS = 10 * 60 * 1000;
const SEEN: Map<string, number> = new Map(); // event_id -> expiresAtMs

function pruneExpired(now: number): void {
  // Cheap incremental cleanup: scan no more than 64 entries per call so
  // the cost stays bounded even if SEEN grows large during a burst.
  let scanned = 0;
  for (const [id, expiresAt] of SEEN) {
    if (scanned++ >= 64) break;
    if (expiresAt <= now) SEEN.delete(id);
  }
}

/**
 * Returns true if this event_id has been seen recently. When false,
 * marks the id as seen so subsequent retries return true.
 *
 * Caller pattern:
 *   if (alreadyProcessed(event.event_id)) return ack();
 *   await doWork();
 */
export function alreadyProcessed(eventId: string | undefined | null): boolean {
  if (!eventId) {
    // Without an id we can't dedup. Better to risk a duplicate than to
    // refuse the event entirely — only the URL-verification handshake
    // legitimately lacks an event_id, and the route handles that branch
    // before this function is consulted.
    return false;
  }
  const now = Date.now();
  pruneExpired(now);

  const existing = SEEN.get(eventId);
  if (existing && existing > now) {
    return true;
  }
  SEEN.set(eventId, now + TTL_MS);
  return false;
}
