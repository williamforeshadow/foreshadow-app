import { getSupabaseServer } from '@/lib/supabaseServer';

// Who gets to run the Concierge generators for a given inbound message.
//
// Exactly one caller should run them, and the question "have they already run?"
// has to be asked directly. The webhook used to infer it from whether its own
// upsert inserted the row — which silently stopped being true once the outbound
// poll became a second writer that creates message rows without running any
// generator. See migration 20260810120000.
//
// The claim is a single conditional UPDATE. Under Postgres' READ COMMITTED a
// concurrent claim blocks on the row lock, re-evaluates the predicate after the
// winner commits, matches nothing, and returns no row — so two simultaneous
// deliveries cannot both win.

/**
 * Try to claim the Concierge generators for a message. Returns true exactly
 * once per message: to the caller that should run them.
 *
 * Claims BEFORE the generators run, not after, because the point is to stop two
 * callers running them at once. The trade-off is unchanged from the old
 * insert-based guard: a claimer that dies mid-generation leaves the message
 * claimed and un-triaged, recoverable through the inbox rather than by retry.
 *
 * A failed claim query returns false — never run generators on an unverified
 * claim, since a duplicate proposal is worse than a late one.
 */
export async function claimConciergeHooks(messageId: string): Promise<boolean> {
  const { data, error } = await getSupabaseServer()
    .from('guest_messages')
    .update({ ai_hooks_claimed_at: new Date().toISOString() })
    .eq('id', messageId)
    .is('ai_hooks_claimed_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[concierge hooks] claim failed', { messageId, error });
    return false;
  }
  return Boolean(data);
}
