'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp } from 'lucide-react';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';
import { useKeyboardInset } from '@/lib/useKeyboardInset';

// The mobile agent bubble, expanded. Tapping the bubble grows it into this
// keyboard-aware liquid-glass composer (a dimmed backdrop + a bottom-anchored
// input) instead of opening the heavy chat panel outright. You type here; only
// on send does the full chat panel come out (open(text) auto-submits it). The
// composer stays pinned just above the software keyboard via visualViewport, so
// there's no black gap / slid-up panel while typing.
export function MobileAgentComposer({ onClose }: { onClose: () => void }) {
  const { open } = useAiChat();
  const keyboardInset = useKeyboardInset();
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Enter animation + focus (focusing raises the keyboard).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const t = window.setTimeout(() => taRef.current?.focus(), 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, []);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Grow the textarea with its content.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const trimmed = text.trim();
  const send = () => {
    if (!trimmed) return;
    // Drop the keyboard so the chat panel comes out cleanly, then hand the
    // prompt to the panel and collapse back to the pill.
    taRef.current?.blur();
    open(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Backdrop — tap to dismiss. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Composer — pinned just above the keyboard. */}
      <div
        className={`absolute inset-x-0 px-3 transition-[transform,opacity] duration-200 ease-out ${
          shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
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
