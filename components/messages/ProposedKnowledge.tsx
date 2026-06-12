'use client';

import { useCallback, useState } from 'react';
import { BookPlus, Check, X, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';

export interface ProposedKnowledgeData {
  id: string;
  summary: string;
  guest_visible: boolean;
  /** The message that triggered the draft; the bubble anchors here. */
  triggering_message_id: string | null;
}

/**
 * A concierge-proposed knowledge addition, rendered beneath the message that
 * prompted it. Accepting writes it into the property's knowledge base (a room
 * note, a card, or a property note) with the chosen guest-visibility — which
 * lets the concierge use the fact in future replies when unlocked. Mirrors
 * ProposedTask. The visibility toggle defaults to the model's suggestion.
 */
export function ProposedKnowledge({
  proposal,
  onChanged,
}: {
  proposal: ProposedKnowledgeData;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [guestVisible, setGuestVisible] = useState(proposal.guest_visible);

  const accept = useCallback(async () => {
    setBusy('accept');
    setError(null);
    try {
      const res = await apiFetch(`/api/proposed-knowledge/${proposal.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_visible: guestVisible }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not save to knowledge.');
        return;
      }
      setAdded(true);
      onChanged?.();
    } catch {
      setError('Could not save to knowledge.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, guestVisible, onChanged]);

  const dismiss = useCallback(async () => {
    setBusy('dismiss');
    setError(null);
    try {
      const res = await apiFetch(`/api/proposed-knowledge/${proposal.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Could not dismiss.');
        return;
      }
      onChanged?.();
    } catch {
      setError('Could not dismiss.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, onChanged]);

  return (
    <div className="mt-4 flex justify-start">
      <div className="w-full max-w-[88%] overflow-hidden rounded-2xl border border-teal-500/60 bg-teal-500/5 dark:border-teal-400/40 dark:bg-teal-400/10">
        <div className="flex items-center gap-1.5 border-b border-teal-500/30 px-3.5 py-1.5 text-[11px] font-medium text-teal-700 dark:text-teal-300">
          <BookPlus className="h-3 w-3" aria-hidden />
          <span>Proposed knowledge</span>
          <span className="font-normal text-teal-600/80 dark:text-teal-400/70">· review</span>
        </div>

        <div className="px-3.5 py-2.5">
          <p className="text-sm leading-snug text-foreground">{proposal.summary}</p>
        </div>

        {error ? (
          <div className="flex items-start gap-2 px-3.5 pb-2 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {added ? (
          <div className="flex items-center gap-1.5 border-t border-teal-500/20 px-3.5 py-2 text-xs text-teal-700 dark:text-teal-300">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Added to property knowledge{guestVisible ? ' · visible to guests' : ' · internal'}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-teal-500/20 px-3 py-2">
            <button
              type="button"
              onClick={() => setGuestVisible((v) => !v)}
              disabled={busy !== null}
              title="Toggle whether the concierge can share this with guests"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
            >
              {guestVisible ? (
                <>
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  Guest-visible
                </>
              ) : (
                <>
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  Internal
                </>
              )}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={dismiss}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
              >
                {busy === 'dismiss' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <X className="h-3.5 w-3.5" aria-hidden />
                )}
                Dismiss
              </button>
              <button
                type="button"
                onClick={accept}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-3)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === 'accept' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <BookPlus className="h-3.5 w-3.5" aria-hidden />
                )}
                Add to knowledge
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
