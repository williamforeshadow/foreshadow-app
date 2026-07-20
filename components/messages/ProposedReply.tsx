'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, SendHorizontal, Pencil, RotateCw, AlertCircle } from 'lucide-react';
import { TrainingReferences } from '@/components/messages/TrainingReferences';
import {
  CONCIERGE_SOURCES_VERSION,
  type ConciergeSource,
  type ConciergeSourcesRecord,
} from '@/lib/conciergeSources';

/**
 * The conversation's proposed reply, rendered beneath the guest message it
 * answers. The draft is PERSISTED on the conversation — generated eagerly when a
 * guest message arrives, or by the ops agent's `concierge` tool. This component
 * reads that stored draft, and asks the server ONCE on open when there's nothing
 * to show or what's stored is stale.
 *
 * Invariant: a STALE draft is never rendered. It answers a message the guest has
 * already spoken past, and the newer message changes what the reply should say.
 * (It's usually worse than merely outdated: with no send path the host answers in
 * the PMS, so a stale draft normally answers something he settled days ago.) It's
 * refreshed silently rather than shown behind a "regenerate?" banner — asking a
 * human to notice a warning before reading the draft puts the most dangerous text
 * on screen and makes noticing it their job.
 *
 * Refreshes go out as `auto` — nobody clicked, so the server runs the same policy
 * the webhook does and may decline (master switch off, or the guest's turn
 * doesn't clear the sensitivity bar). A decline renders as a quiet "no reply
 * needed" row: the gate's ruling is the product, and ↻ Draft anyway overrides it.
 *
 * It does NOT re-ask when a fresh draft exists or the gate has already ruled on
 * this message, so re-opening a thread stays a cheap read either way.
 * Regenerate (↻) re-rolls + re-stores; Edit copies to the composer; Send stubbed.
 */
export function ProposedReply({
  conversationId,
  draft: persistedDraft,
  source,
  sources: persistedSources,
  stale,
  declined,
  onEdit,
  onChanged,
}: {
  conversationId: string;
  /** The stored draft, or null when none has been generated yet. */
  draft: string | null;
  source: 'auto' | 'assistant' | null;
  /**
   * What grounded the stored draft. null on drafts written before sources were
   * recorded — the chips row renders nothing rather than claiming it used nothing.
   */
  sources: ConciergeSourcesRecord | null;
  /** True when a newer guest message arrived after this draft was written. */
  stale: boolean;
  /** True when the sensitivity gate ruled this message doesn't warrant a reply. */
  declined: boolean;
  onEdit: (text: string) => void;
  /** Called after a (re)generate so the parent can refetch the conversation. */
  onChanged?: () => void;
}) {
  // A stale draft is never rendered — see the auto-refresh effect below — so it
  // starts blank and the skeleton covers the refresh.
  const [draft, setDraft] = useState(stale ? '' : persistedDraft ?? '');
  // Sources move in lockstep with `draft` — they caption the text on screen, so
  // a stale draft's grounding is dropped exactly when its text is.
  const [sources, setSources] = useState<ConciergeSourcesRecord | null>(
    stale ? null : persistedSources,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A decline the server reported on THIS mount, before the parent has refetched
  // the conversation row that carries it.
  const [justDeclined, setJustDeclined] = useState(false);
  // Refresh-when-missing-or-stale fires at most once per mount (the component is
  // keyed by the guest message, so it remounts fresh per conversation / message).
  const autoTried = useRef(false);

  // Sync when the stored draft changes (conversation switch / parent refetch).
  useEffect(() => {
    setDraft(stale ? '' : persistedDraft ?? '');
    setSources(stale ? null : persistedSources);
  }, [persistedDraft, persistedSources, stale]);

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
        // Set from the same response as the draft: the parent's refetch lands a
        // beat later, and until it does the chips would describe the previous
        // generation's grounding.
        setSources(
          Array.isArray(data.sources)
            ? { version: CONCIERGE_SOURCES_VERSION, sources: data.sources as ConciergeSource[] }
            : null,
        );
        onChanged?.();
      } catch {
        setError('Could not generate a proposed reply.');
      } finally {
        setLoading(false);
      }
    },
    [conversationId, onChanged],
  );

  // Nothing drafted, OR what's stored answers a message the guest has already
  // spoken past → ask once, on the autonomous path. Once a fresh draft persists
  // (or a decline is recorded), this never fires again for this thread.
  //
  // A stale draft is refreshed rather than shown with a "regenerate?" prompt.
  // The newer message changes what the reply should say, and asking a human to
  // notice a banner before reading the draft gets that backwards — the stale text
  // is the most dangerous thing on screen, not something to offer for review.
  // The refresh goes out as `auto`, so the gate still decides: a substantive turn
  // yields a new draft, a pure "thanks" clears it and shows "no reply needed".
  useEffect(() => {
    if ((!persistedDraft || stale) && !declined && !autoTried.current) {
      autoTried.current = true;
      void generate(true);
    }
  }, [persistedDraft, stale, declined, generate]);

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
          {/* The references button takes the "· not sent" slot, but only once a
              real draft is on screen: mid-regenerate `sources` still holds the
              PREVIOUS generation's record, and a popup describing a draft that's
              being replaced is the same trap the stale-draft rule exists to
              avoid. Drafts written before sources were recorded have nothing to
              open, so they keep the original label rather than offering a button
              that opens an empty popup. */}
          {showActions && sources ? (
            <TrainingReferences sources={sources} />
          ) : (
            <span className="font-normal opacity-70">· not sent</span>
          )}
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
