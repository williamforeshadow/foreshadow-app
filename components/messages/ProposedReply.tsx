'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, SendHorizontal, Pencil, RotateCw, AlertCircle } from 'lucide-react';

/**
 * The conversation's proposed reply, rendered beneath the guest message it
 * answers. The draft is PERSISTED on the conversation — generated eagerly when a
 * guest message arrives, or by the ops agent's `concierge` tool. This component
 * reads that stored draft. If none exists yet (e.g. a historical thread or one
 * eager generation missed), it generates one ONCE on open and stores it — so a
 * reply is always just there, no button to click. Crucially it does NOT
 * regenerate when a draft already exists, so re-opening a thread is a cheap read.
 * Regenerate (↻) re-rolls + re-stores; Edit copies to the composer; Send stubbed.
 */
export function ProposedReply({
  conversationId,
  draft: persistedDraft,
  source,
  stale,
  onEdit,
  onChanged,
}: {
  conversationId: string;
  /** The stored draft, or null when none has been generated yet. */
  draft: string | null;
  source: 'auto' | 'assistant' | null;
  /** True when a newer guest message arrived after this draft was written. */
  stale: boolean;
  onEdit: (text: string) => void;
  /** Called after a (re)generate so the parent can refetch the conversation. */
  onChanged?: () => void;
}) {
  const [draft, setDraft] = useState(persistedDraft ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Generate-when-missing fires at most once per mount (the component is keyed by
  // the guest message, so it remounts fresh per conversation / new message).
  const autoTried = useRef(false);

  // Sync when the stored draft changes (conversation switch / parent refetch).
  useEffect(() => {
    setDraft(persistedDraft ?? '');
  }, [persistedDraft]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/messages/${conversationId}/draft`, { method: 'POST' });
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d) => (typeof d?.error === 'string' ? d.error : ''))
          .catch(() => '');
        setError(msg || 'Could not generate a proposed reply.');
        return;
      }
      const data = await res.json();
      setDraft(typeof data.draft === 'string' ? data.draft : '');
      onChanged?.();
    } catch {
      setError('Could not generate a proposed reply.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, onChanged]);

  // No stored draft yet → generate one once, automatically. Once it's persisted,
  // persistedDraft becomes non-null and this never fires again for this thread.
  useEffect(() => {
    if (!persistedDraft && !autoTried.current) {
      autoTried.current = true;
      void generate();
    }
  }, [persistedDraft, generate]);

  const handleSend = useCallback(() => {
    setNote('Sending isn’t available yet. Use Edit to refine, then send from your channel.');
  }, []);

  const showSkeleton = loading || (!draft && !error);
  const showActions = !!draft && !loading && !error;

  return (
    <div className="mt-4 flex justify-end">
      <div className="msg-in w-full max-w-[88%] overflow-hidden rounded-2xl border border-amber-500/35 dark:border-amber-400/30">
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
            onClick={generate}
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
