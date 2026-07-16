'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, SendHorizontal, Pencil, RotateCw, AlertCircle } from 'lucide-react';

/**
 * The conversation's proposed reply, rendered beneath the guest message it
 * answers. The draft is PERSISTED on the conversation — generated eagerly when a
 * guest message arrives, or by the ops agent's `concierge` tool. This component
 * reads that stored draft. If none exists yet (e.g. a historical thread or one
 * eager generation missed), it asks the server ONCE on open.
 *
 * That open-time ask goes out as `auto` — nobody clicked anything, so the server
 * runs the same policy the webhook does and may decline (the org's master switch
 * is off, or the message doesn't clear the sensitivity bar). A decline renders as
 * a quiet "no reply needed" row, NOT a draft: the gate's ruling is the product,
 * and the operator can always override it with ↻ Draft anyway.
 *
 * It does NOT re-ask when a draft already exists, or when the gate has already
 * ruled on this message — so re-opening a thread stays a cheap read either way.
 * Regenerate (↻) re-rolls + re-stores; Edit copies to the composer; Send stubbed.
 */
export function ProposedReply({
  conversationId,
  draft: persistedDraft,
  source,
  stale,
  declined,
  onEdit,
  onChanged,
}: {
  conversationId: string;
  /** The stored draft, or null when none has been generated yet. */
  draft: string | null;
  source: 'auto' | 'assistant' | null;
  /** True when a newer guest message arrived after this draft was written. */
  stale: boolean;
  /** True when the sensitivity gate ruled this message doesn't warrant a reply. */
  declined: boolean;
  onEdit: (text: string) => void;
  /** Called after a (re)generate so the parent can refetch the conversation. */
  onChanged?: () => void;
}) {
  const [draft, setDraft] = useState(persistedDraft ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A decline the server reported on THIS mount, before the parent has refetched
  // the conversation row that carries it.
  const [justDeclined, setJustDeclined] = useState(false);
  // Generate-when-missing fires at most once per mount (the component is keyed by
  // the guest message, so it remounts fresh per conversation / new message).
  const autoTried = useRef(false);

  // Sync when the stored draft changes (conversation switch / parent refetch).
  useEffect(() => {
    setDraft(persistedDraft ?? '');
  }, [persistedDraft]);

  // `auto` = nobody asked; the server applies the master switch + sensitivity
  // gate and may decline. Omitting it marks an explicit human ask, which always
  // drafts — that's what makes ↻ an override rather than another roll of the dice.
  const generate = useCallback(
    async (auto = false) => {
      setLoading(true);
      setError(null);
      setNote(null);
      try {
        const res = await fetch(`/api/messages/${conversationId}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto }),
        });
        if (!res.ok) {
          const msg = await res
            .json()
            .then((d) => (typeof d?.error === 'string' ? d.error : ''))
            .catch(() => '');
          setError(msg || 'Could not generate a proposed reply.');
          return;
        }
        const data = await res.json();
        // The autonomous policy declined. Not an error — show the quiet state.
        if (data?.skipped) {
          setJustDeclined(true);
          return;
        }
        setDraft(typeof data.draft === 'string' ? data.draft : '');
        onChanged?.();
      } catch {
        setError('Could not generate a proposed reply.');
      } finally {
        setLoading(false);
      }
    },
    [conversationId, onChanged],
  );

  // Nothing drafted and the gate hasn't ruled on this message yet → ask once, on
  // the autonomous path. Once a draft persists (or a decline is recorded), this
  // never fires again for this thread.
  useEffect(() => {
    if (!persistedDraft && !declined && !autoTried.current) {
      autoTried.current = true;
      void generate(true);
    }
  }, [persistedDraft, declined, generate]);

  const handleSend = useCallback(() => {
    setNote('Sending isn’t available yet. Use Edit to refine, then send from your channel.');
  }, []);

  // The gate ruled no reply was needed AND there's nothing else to show. An older
  // draft still standing beneath a newer declined message keeps its bubble
  // (marked stale) — the question it answers is still unanswered.
  const showDeclined = (declined || justDeclined) && !draft && !loading && !error;
  const showSkeleton = loading || (!draft && !error);
  const showActions = !!draft && !loading && !error;

  // Deliberately quiet: muted, one line, no amber. Amber means "a draft is
  // waiting for you" — this is the opposite, and reads as noise if it shouts.
  if (showDeclined) {
    return (
      <div className="mt-4 flex justify-end">
        <div className="msg-in msg-well flex w-full max-w-[88%] items-center gap-2 rounded-2xl px-3.5 py-2 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          <span>No reply needed · the Concierge skipped this one</span>
          <button
            type="button"
            onClick={() => generate(false)}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            <RotateCw className="h-3 w-3" aria-hidden />
            Draft anyway
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex justify-end">
      <div className="msg-in glass-card glass-sheen relative w-full max-w-[88%] overflow-hidden rounded-2xl border bg-[var(--proposal-reply-bg)] border-[var(--proposal-reply-border)]">
        <div className="flex items-center gap-1.5 px-3.5 pt-2.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          <Sparkles className="h-3 w-3" aria-hidden />
          <span>Proposed Reply</span>
          <span className="font-normal opacity-70">· not sent</span>
          {source === 'assistant' ? (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium dark:bg-amber-400/15">
              via assistant
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={loading}
            aria-label="Regenerate proposed reply"
            title="Regenerate"
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-amber-500/15 disabled:opacity-40 dark:hover:bg-amber-400/15"
          >
            <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>

        {stale && !loading ? (
          <p className="mx-3.5 mt-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
            A newer guest message has arrived since this draft — regenerate to refresh it.
          </p>
        ) : null}

        <div className="px-3.5 py-2.5">
          {showSkeleton ? (
            <div className="space-y-1.5 py-0.5" aria-label="Generating proposed reply">
              <span className="msg-shimmer block h-3 w-full rounded" />
              <span className="msg-shimmer block h-3 w-4/5 rounded" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <span>{error} Use ↻ to try again.</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {draft}
            </p>
          )}
        </div>

        {note ? (
          <p role="status" className="px-3.5 pb-1.5 text-[11px] text-muted-foreground">
            {note}
          </p>
        ) : null}

        {showActions ? (
          <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
            <button
              type="button"
              onClick={() => onEdit(draft)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-amber-500/15 dark:hover:bg-amber-400/15"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </button>
            <button
              type="button"
              onClick={handleSend}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-medium text-amber-950 shadow-sm transition-opacity hover:opacity-90"
            >
              <SendHorizontal className="h-3.5 w-3.5" aria-hidden />
              Send
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
