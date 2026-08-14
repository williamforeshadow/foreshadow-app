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
// Two ways to use it:
//   - With a `scrollRef`: attach `handlers` to that container and put
//     `keyboardPadding` in its style. (The task panel / checklist pattern.)
//   - Without a ref (auto mode): attach `handlers` to any shared wrapper —
//     the hook finds the focused field's nearest scrollable ancestor at
//     scroll time and pads it inline while typing. One attachment covers
//     many inner scrollers (the properties shell, dialogs, sheets).
export function useEditableKeyboardOverlay(
  scrollRef?: React.RefObject<HTMLElement | null>
) {
  const visualInset = useKeyboardInset();
  const nativeInset = useNativeKeyboardHeight();
  const keyboardInset = Math.max(visualInset, nativeInset);
  const [typing, setTyping] = React.useState(false);

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

  // Auto mode pads the discovered container inline; remembered here so the
  // previous value is restored when typing ends or the container changes.
  const paddedRef = React.useRef<{ el: HTMLElement; prev: string } | null>(null);
  const restorePadding = React.useCallback(() => {
    if (!paddedRef.current) return;
    paddedRef.current.el.style.paddingBottom = paddedRef.current.prev;
    paddedRef.current = null;
  }, []);
  React.useEffect(() => restorePadding, [restorePadding]);

  // Keep the caret above the keyboard. For contenteditable the active element
  // is the whole editor (often taller than the visible strip), so prefer the
  // selection rect when it has geometry.
  React.useEffect(() => {
    if (!typing || keyboardInset === 0) {
      restorePadding();
      return;
    }
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return;

    let sc: HTMLElement | null;
    if (scrollRef) {
      sc = scrollRef.current;
      if (!sc || !sc.contains(el)) return;
    } else {
      sc = scrollableAncestor(el);
      if (sc) {
        if (paddedRef.current && paddedRef.current.el !== sc) restorePadding();
        if (!paddedRef.current) {
          paddedRef.current = { el: sc, prev: sc.style.paddingBottom };
        }
        sc.style.paddingBottom = `${keyboardInset + 24}px`;
      }
    }

    let rect = el.getBoundingClientRect();
    const sel = window.getSelection();
    if (el.isContentEditable && sel && sel.rangeCount > 0) {
      const caretRect = sel.getRangeAt(0).getBoundingClientRect();
      if (caretRect.height > 0 || caretRect.width > 0) rect = caretRect;
    }
    const visibleBottom = window.innerHeight - keyboardInset - 16;
    if (rect.bottom > visibleBottom && sc) {
      sc.scrollBy({ top: rect.bottom - visibleBottom, behavior: 'smooth' });
    }
  }, [typing, keyboardInset, scrollRef, restorePadding]);

  return {
    keyboardInset,
    typing,
    handlers,
    /** Bottom padding for the scroll container while the keyboard is up
     *  (scrollRef mode — auto mode pads the found container itself). */
    keyboardPadding: keyboardInset > 0 ? keyboardInset + 24 : undefined,
  };
}

function isEditable(t: EventTarget | null): t is HTMLElement {
  return (
    t instanceof HTMLElement &&
    (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
  );
}

// Nearest ancestor that can actually scroll vertically. overflow-y auto/scroll
// is enough — a container that isn't overflowing YET becomes scrollable once
// the keyboard padding lands in it.
function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  let n: HTMLElement | null = el.parentElement;
  while (n) {
    const overflowY = getComputedStyle(n).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return n;
    n = n.parentElement;
  }
  return null;
}

// The minimal version for surfaces that only need the screen to stop moving
// (top-anchored search bars): arm overlay mode around focus, nothing else.
// Spread the returned props onto the input itself.
export function useArmKeyboardOverlay() {
  React.useEffect(() => () => void setChatKeyboardOverlay(false), []);
  return React.useMemo(
    () => ({
      onTouchStart: () => void setChatKeyboardOverlay(true),
      onFocus: () => void setChatKeyboardOverlay(true),
      onBlur: () => void setChatKeyboardOverlay(false),
    }),
    []
  );
}
