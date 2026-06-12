'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SendHorizontal, Sparkles, Loader2 } from 'lucide-react';

/**
 * Reply composer pinned to the bottom of a conversation thread.
 *
 * Controlled: the parent owns the text (`value`/`onChange`) so the in-thread
 * proposed reply's "Edit" can populate it. Typing works and "AI draft"
 * generates a reply into the box. Actually SENDING isn't wired yet, so the send
 * button surfaces an honest note instead of pretending it sent.
 *
 * `focusSignal`: bump it from the parent to focus the textarea and drop the
 * cursor at the end (used when "Edit" loads a proposed reply in here).
 */
const MAX_HEIGHT = 160; // px before the textarea scrolls internally

export function MessageComposer({
  guestName,
  conversationId,
  value,
  onChange,
  focusSignal,
}: {
  guestName?: string | null;
  conversationId?: string;
  value: string;
  onChange: (value: string) => void;
  focusSignal?: number;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const firstName = guestName?.trim().split(/\s+/)[0];
  const placeholder = firstName ? `Message ${firstName}…` : 'Write a reply…';
  const trimmed = value.trim();

  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  // Keep the textarea sized to its content for both typing and injected text.
  useEffect(() => {
    autosize();
  }, [value, autosize]);

  // Parent asked us to take focus (e.g. after "Edit" loaded a proposed reply).
  useEffect(() => {
    if (focusSignal === undefined) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusSignal]);

  const handleSend = useCallback(() => {
    if (!trimmed) return;
    setNote('Sending isn’t available yet. Your draft is kept here.');
  }, [trimmed]);

  const handleDraft = useCallback(async () => {
    if (!conversationId || drafting) return;
    setDrafting(true);
    setNote(null);
    try {
      const res = await fetch(`/api/messages/${conversationId}/draft`, { method: 'POST' });
      if (!res.ok) {
        const serverMsg = await res
          .json()
          .then((d) => (typeof d?.error === 'string' ? d.error : ''))
          .catch(() => '');
        setNote(serverMsg || 'Could not draft a reply right now. Try again in a moment.');
        return;
      }
      const data = await res.json();
      const draft = typeof data.draft === 'string' ? data.draft : '';
      if (!draft) {
        setNote('No draft was generated. Try again or write one yourself.');
        return;
      }
      onChange(draft);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(draft.length, draft.length);
        }
      });
    } catch {
      setNote('Could not draft a reply right now. Try again in a moment.');
    } finally {
      setDrafting(false);
    }
  }, [conversationId, drafting, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      className="shrink-0 px-3 pt-2"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      {note ? (
        <p role="status" className="mb-2 px-1 text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}

      <div className="msg-well flex items-end gap-2 rounded-2xl px-2 py-2 transition-[border-color,box-shadow] focus-within:border-[var(--accent-3)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)] dark:focus-within:ring-[var(--accent-ring-dark)]">
        {conversationId ? (
          <button
            type="button"
            onClick={handleDraft}
            disabled={drafting}
            aria-label="Draft a reply with AI"
            title="Draft a reply with AI"
            className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--accent-3)] transition-colors hover:bg-[var(--accent-bg-soft)] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-[var(--accent-bg-soft-dark)]"
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : null}

        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (note) setNote(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={drafting ? 'Drafting a reply…' : placeholder}
          aria-label="Write a message"
          disabled={drafting}
          className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!trimmed}
          aria-label="Send message"
          className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-[opacity,transform] hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
