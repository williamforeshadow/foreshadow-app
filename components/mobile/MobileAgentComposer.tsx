'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp } from 'lucide-react';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';
import { useKeyboardInset } from '@/lib/useKeyboardInset';

// The mobile agent bubble, expanded. Tapping the pill grows it into this
// keyboard-aware liquid-glass composer (a dimmed backdrop + a bottom-anchored
// input) instead of opening the heavy chat panel outright. You type here; only
// on send does the full chat panel come out (open(text) auto-submits it). The
// composer stays pinned just above the software keyboard via visualViewport, so
// there's no black gap / slid-up panel while typing.
//
// Driven by an `open` prop rather than mount/unmount so it can animate both
// ways: the pill fades out and the composer scales up from the bottom (reading
// as the pill expanding), and reverses on close.

const ANIM_MS = 260;

export function MobileAgentComposer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { open: openChat } = useAiChat();
  const keyboardInset = useKeyboardInset();
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Keep mounted through the exit transition: `shouldRender` gates the DOM,
  // `shown` drives the scale/opacity. Mount-on-open and start-of-exit are
  // render-time adjustments; the deferred flips run in effects.
  const [shouldRender, setShouldRender] = useState(open);
  const [shown, setShown] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open && !shouldRender) setShouldRender(true);
  if (!open && shown) setShown(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setText(''); // fresh input each time it opens
  }

  // Enter: flip `shown` on just after the mounted (scaled-down) composer paints
  // so it transitions up. setTimeout (not requestAnimationFrame) so it still
  // fires when the tab is backgrounded — the composer must never get stuck
  // invisible.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setShown(true), 16);
    return () => window.clearTimeout(t);
  }, [open]);

  // Exit: unmount after the collapse transition finishes.
  useEffect(() => {
    if (open || !shouldRender) return;
    const t = window.setTimeout(() => setShouldRender(false), ANIM_MS);
    return () => window.clearTimeout(t);
  }, [open, shouldRender]);

  // Focus once open (focusing raises the keyboard). `preventScroll` stops the
  // browser from scrolling the whole page up to reveal the input — the app
  // stays put and only the composer (pinned via visualViewport) rises above the
  // keyboard.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => taRef.current?.focus({ preventScroll: true }), 120);
    return () => window.clearTimeout(t);
  }, [open]);

  // Belt-and-suspenders: lock body scroll while open so the page behind can't be
  // scrolled up as the keyboard opens.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Grow the textarea with its content.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  if (!shouldRender) return null;

  const trimmed = text.trim();
  const send = () => {
    if (!trimmed) return;
    // Drop the keyboard so the chat panel comes out cleanly, then hand the
    // prompt to the panel and collapse back to the pill.
    taRef.current?.blur();
    openChat(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Backdrop — tap to dismiss. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-[260ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Composer — scales up from the bottom (where the pill sits) and pins
          just above the keyboard. */}
      <div
        className={`absolute inset-x-0 origin-bottom px-3 transition-[transform,opacity] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          shown ? 'scale-100 opacity-100' : 'scale-[0.68] opacity-0'
        }`}
        style={{
          bottom: keyboardInset
            ? keyboardInset + 8
            : 'calc(env(safe-area-inset-bottom) + 0.5rem)',
        }}
      >
        <div className="agent-glass flex items-end gap-2 rounded-[1.5rem] px-3 py-2.5">
          <Sparkles
            className="mb-1.5 h-[18px] w-[18px] shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]"
            aria-hidden
          />
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPointerDown={(e) => {
              // Re-tapping the input after the keyboard was dismissed is a user
              // focus, which the browser scrolls the page up to reveal — the
              // same shift preventScroll fixes on the programmatic focus. Take
              // over: focus it ourselves with preventScroll. Skip when already
              // focused so tap-to-position-caret still works.
              if (taRef.current && document.activeElement !== taRef.current) {
                e.preventDefault();
                taRef.current.focus({ preventScroll: true });
              }
            }}
            rows={1}
            placeholder="Ask the agent…"
            aria-label="Ask the agent"
            className="max-h-[140px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 text-foreground outline-none placeholder:text-foreground/50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!trimmed}
            aria-label="Send"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-opacity disabled:opacity-30 dark:bg-[var(--accent-1)]"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
