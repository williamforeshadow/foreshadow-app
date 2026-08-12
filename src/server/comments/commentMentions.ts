import type { SupabaseClient } from '@supabase/supabase-js';
import { mentionedUserIds } from '@/lib/mentions';

// Service: resolve and persist @-mentions for a just-inserted comment.
//
// Shared by every comment writer (the /api/project-comments POST route and
// the agent's addComment service, which the batch tool loops over) so all
// paths agree on what counts as a mention. The client's parsed tokens are
// never trusted: uuids are re-parsed from the stored text here and validated
// org-scoped, so a token pointing at a cross-org or unknown user is inert
// plain text — no mention row, no notification.
//
// Best-effort by design, mirroring the notification calls it feeds: a
// failure here must not fail the comment write that already happened.

/** Guardrail against pathological comments; far above any real usage. */
const MAX_MENTIONS_PER_COMMENT = 20;

export interface ResolvedMentions {
  /** users.id values that exist in the actor's org, first-appearance order. */
  userIds: string[];
}

/**
 * Parse mention tokens out of `commentContent`, keep the ids that are real
 * users in `orgId`, and upsert them into comment_mentions for `commentId`.
 * Returns the validated ids so the caller can notify. Never throws.
 *
 * `supabase` should be the service-role client: mentions must resolve even
 * when the author's user-scoped client can't read the mentioned user row.
 */
export async function resolveAndStoreMentions(args: {
  supabase: SupabaseClient;
  orgId: string;
  commentId: string;
  commentContent: string;
}): Promise<ResolvedMentions> {
  const candidateIds = mentionedUserIds(args.commentContent).slice(
    0,
    MAX_MENTIONS_PER_COMMENT,
  );
  if (candidateIds.length === 0) return { userIds: [] };

  try {
    const { data: users, error } = await args.supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('org_id', args.orgId);
    if (error || !users || users.length === 0) {
      if (error) {
        console.warn('[mentions] user validation failed', {
          commentId: args.commentId,
          error,
        });
      }
      return { userIds: [] };
    }

    const validSet = new Set(users.map((u) => u.id as string));
    const validIds = candidateIds.filter((id) => validSet.has(id));
    if (validIds.length === 0) return { userIds: [] };

    const { error: insertError } = await args.supabase
      .from('comment_mentions')
      .upsert(
        validIds.map((userId) => ({
          comment_id: args.commentId,
          mentioned_user_id: userId,
          org_id: args.orgId,
        })),
        { onConflict: 'comment_id,mentioned_user_id', ignoreDuplicates: true },
      );
    if (insertError) {
      console.warn('[mentions] insert failed', {
        commentId: args.commentId,
        error: insertError,
      });
      return { userIds: [] };
    }

    return { userIds: validIds };
  } catch (err) {
    console.warn('[mentions] unexpected failure', {
      commentId: args.commentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { userIds: [] };
  }
}
