'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, SendHorizontal, Pencil, RotateCw, AlertCircle } from 'lucide-react';

/**
 * An AI-proposed reply rendered inline beneath the guest message it answers,
 * whenever that message is awaiting a host reply. Visually marked as a DRAFT
 * (amber, "not sent"). It PERSISTS: Edit copies the text to the composer but
 * never removes the card, and a real reply just appears after it in the thread.
 * Send is stubbed (no send path yet); Regenerate (↻) re-rolls it.
 *
 * Generates once on mount; the parent anchors it (keyed by the guest message id)
 * so thread reloads don't remount or regenerate it.
 */
export function ProposedReply({
  conversationId,
  onEdit,
}: {
  conversationId: string;
  onEdit: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
    } catch {
      setError('Could not generate a proposed reply.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Generate once on mount. The card is anchored to a specific guest message,
  // so it should not regenerate as the thread changes (use ↻ to re-roll).
  useEffect(() => {
    generate();
  }, [generate]);

  const handleSend = useCallback(() => {
    setNote('Sending isn’t available yet. Use Edit to refine, then send from your channel.');
  }, []);

  return (
    <div className="mt-4 flex justify-end">
      <div className="w-full max-w-[88%] overflow-hidden rounded-2xl border border-amber-500/60 bg-amber-500/5 dark:border-amber-400/40 dark:bg-amber-400/10">
        <div className="flex items-center gap-1.5 border-b border-amber-500/30 px-3.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <Sparkles className="h-3 w-3" aria-hidden />
          <span>Proposed reply</span>
          <span className="font-normal text-amber-600/80 dark:text-amber-400/70">· not sent</span>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            aria-label="Regenerate proposed reply"
            title="Regenerate"
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-amber-700/80 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-300/80"
          >
            <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>

        <div className="px-3.5 py-2.5">
          {loading ? (
            <div className="space-y-1.5 py-0.5" aria-label="Generating proposed reply">
              <span className="block h-3 w-full animate-pulse rounded bg-amber-500/15" />
              <span className="block h-3 w-4/5 animate-pulse rounded bg-amber-500/15" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>{error}</span>
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

        {!loading && !error ? (
          <div className="flex items-center justify-end gap-2 border-t border-amber-500/20 px-3 py-2">
            <button
              type="button"
              onClick={() => onEdit(draft)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </button>
            <button
              type="button"
              onClick={handleSend}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-3)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
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
