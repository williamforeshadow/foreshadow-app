'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

// Scoped keyboard-overlay control for the mobile agent chat.
//
// On iOS the Capacitor WebView defaults to "native resize": when the software
// keyboard opens, the whole WebView physically shrinks to sit above it. That
// drags every `position: fixed` element up with it, so a bottom-anchored drawer
// can't stay pinned to the screen bottom and nothing renders behind the
// keyboard. (`interactiveWidget: resizes-visual`, which we set in the viewport,
// only affects Android Chrome — iOS WKWebView ignores it.)
//
// While the chat is open we switch to overlay mode (resize: none) so the WebView
// stays full-screen and the keyboard floats over it; then only our floating
// input needs to track the keyboard (via visualViewport) while the drawer stays
// put. We restore the default on close so every other screen keeps its current
// keyboard behavior. No-op on web and if the plugin isn't in the native shell.
export async function setChatKeyboardOverlay(on: boolean): Promise<void> {
  if (!Capacitor?.isNativePlatform?.()) return;
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({
      mode: on ? KeyboardResize.None : KeyboardResize.Native,
    });
    // With overlay mode we position the input ourselves, so stop WKWebView from
    // also scrolling the focused field into view (which would shift the drawer).
    await Keyboard.setScroll({ isDisabled: on });
  } catch {
    // Plugin not available yet (e.g. web, or a native shell built before the
    // plugin was synced in) — fall back to the default behavior silently.
  }
}

// The keyboard height (CSS px) reported by the native @capacitor/keyboard plugin,
// 0 when hidden or on web. In overlay mode (resize: none) the WebView no longer
// shrinks, so iOS stops reporting the keyboard through window.visualViewport —
// the plugin's keyboardWillShow/Hide events become the only reliable signal for
// how far to lift the floating input. Uses "will" events so the input leads the
// keyboard as it animates in/out. No-op (returns 0) on web.
export function useNativeKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!Capacitor?.isNativePlatform?.()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard');
        const show = await Keyboard.addListener('keyboardWillShow', (info) => {
          setHeight(info?.keyboardHeight || 0);
        });
        const hide = await Keyboard.addListener('keyboardWillHide', () => {
          setHeight(0);
        });
        if (cancelled) {
          show.remove();
          hide.remove();
          return;
        }
        cleanup = () => {
          show.remove();
          hide.remove();
        };
      } catch {
        // Plugin unavailable — leave height at 0.
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return height;
}
