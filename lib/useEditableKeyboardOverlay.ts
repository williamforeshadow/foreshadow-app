'use client';

import * as React from 'react';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import {
  setChatKeyboardOverlay,
  useNativeKeyboardHeight,
} from '@/lib/nativeKeyboard';

// The keyboard treatment for scrollable surfaces with inline editable fields
// (textareas, inputs, contenteditable rich text), extracted from the AI
// chat's playbook:
//
//   - On iOS the default "native resize" mode shrinks the whole WebView when
//     the keyboard opens — the screen visibly jumps and the rounded-corner
//     keyboard exposes the window behind it as black. So the first touch on
//     an editable field (which precedes focus, and therefore the keyboard)
//     flips the WebView to keyboard-overlay mode: the screen stays put and
//     the keyboard floats over it.
//   - Overlay mode also disables WKWebView's own scroll-into-view, so the
//     host scroll container takes that job: pad past the keyboard and scroll
//     the caret to sit just above it.
//
// Attach `handlers` to the scroll container, put `keyboardPadding` in its
// style, and everything inside — including fields added later — is covered.
export function useEditableKeyboardOverlay(
  scrollRef: React.RefObject<HTMLElement | null>
) {
  const visualInset = useKeyboardInset();
  const nativeInset = useNativeKeyboardHeight();
  const keyboardInset = Math.max(visualInset, nativeInset);
  const [typing, setTyping] = React.useState(false);

  const isEditable = (t: EventTarget | null): t is HTMLElement =>
    t instanceof HTMLElement &&
    (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);

  const handlers = React.useMemo(
    () => ({
      onTouchStartCapture: (e: React.TouchEvent) => {
        if (isEditable(e.target)) void setChatKeyboardOverlay(true);
      },
      onFocusCapture: (e: React.FocusEvent) => {
        if (!isEditable(e.target)) return;
        void setChatKeyboardOverlay(true);
        setTyping(true);
      },
      onBlurCapture: (e: React.FocusEvent) => {
        if (!isEditable(e.target)) return;
        void setChatKeyboardOverlay(false);
        setTyping(false);
      },
    }),
    []
  );

  // Never leave overlay mode armed past the host's lifetime.
  React.useEffect(() => () => void setChatKeyboardOverlay(false), []);

  // Keep the caret above the keyboard. For contenteditable the active element
  // is the whole editor (often taller than the visible strip), so prefer the
  // selection rect when it has geometry.
  React.useEffect(() => {
    if (!typing || keyboardInset === 0) return;
    const el = document.activeElement;
    const sc = scrollRef.current;
    if (!(el instanceof HTMLElement) || !sc || !sc.contains(el)) return;
    let rect = el.getBoundingClientRect();
    const sel = window.getSelection();
    if (el.isContentEditable && sel && sel.rangeCount > 0) {
      const caretRect = sel.getRangeAt(0).getBoundingClientRect();
      if (caretRect.height > 0 || caretRect.width > 0) rect = caretRect;
    }
    const visibleBottom = window.innerHeight - keyboardInset - 16;
    if (rect.bottom > visibleBottom) {
      sc.scrollBy({ top: rect.bottom - visibleBottom, behavior: 'smooth' });
    }
  }, [typing, keyboardInset, scrollRef]);

  return {
    keyboardInset,
    typing,
    handlers,
    /** Bottom padding for the scroll container while the keyboard is up. */
    keyboardPadding: keyboardInset > 0 ? keyboardInset + 24 : undefined,
  };
}
