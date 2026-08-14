'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles, Loader2 } from 'lucide-react';

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
  onSend,
  focusSignal,
}: {
  guestName?: string | null;
  conversationId?: string;
  value: string;
  onChange: (value: string) => void;
  /** Send the composed text through the PMS; resolves true on success (we then
   *  clear the box). Absent ⇒ send surfaces an honest "not wired" note. */
  onSend?: (text: string) => Promise<boolean>;
  focusSignal?: number;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
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

  const handleSend = useCallback(async () => {
    if (!trimmed || sending) return;
    if (!onSend) {
      setNote('Sending isn’t available for this conversation.');
      return;
    }
    setSending(true);
    setNote(null);
    const ok = await onSend(trimmed);
    // Clear only on success; on failure the parent has toasted and we keep the
    // text so it isn't lost.
    if (ok) onChange('');
    setSending(false);
  }, [trimmed, sending, onSend, onChange]);

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

      {/* Liquid-glass bubble — the same shell as the AI chat input and the
          task comment bar, so every composer in the app reads as one family.
          The sparkles button stays: here it's the functional AI-draft action,
          not decoration. */}
      <div className="flex items-end gap-2 rounded-[1.375rem] border py-[7px] pl-2.5 pr-[7px] backdrop-blur-[14px] backdrop-saturate-150 border-[rgba(0,0,0,0.12)] bg-[rgba(255,255,255,0.72)] shadow-[0_2px_10px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(38,38,44,0.62)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]">
        {conversationId ? (
          <button
            type="button"
            onClick={handleDraft}
            disabled={drafting}
            aria-label="Draft a reply with AI"
            title="Draft a reply with AI"
            className="mb-[3px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--accent-3)] transition-colors hover:bg-[var(--accent-bg-soft)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--accent-1)] dark:hover:bg-[var(--accent-bg-soft-dark)]"
          >
            {drafting ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-[18px] w-[18px]" aria-hidden />
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
          disabled={drafting || sending}
          className="max-h-40 min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 text-[15px] leading-normal text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70 [scrollbar-width:thin]"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!trimmed || sending}
          aria-label="Send message"
          className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-[var(--accent-1)] dark:text-[#12121a]"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowUp size={16} aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
