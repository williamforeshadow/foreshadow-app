'use client';

import { useEffect, useState } from 'react';

/**
 * The height (px) the on-screen keyboard currently occupies at the bottom of
 * the viewport, derived from `window.visualViewport`. 0 when no keyboard is up.
 *
 * WKWebView (the Capacitor iOS shell) and mobile browsers shrink the *visual*
 * viewport when the software keyboard opens, but leave the *layout* viewport
 * (what `position: fixed` / `100vh` size against) unchanged — which is why a
 * full-height fixed panel slides up and leaves black behind the keyboard.
 * Pinning a bottom-anchored element `keyboardInset` px up keeps it just above
 * the keyboard. No native plugin needed, so it ships through the web deploy.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Only the event callbacks call setState (never synchronously in the effect
    // body); initial 0 is correct since no keyboard is up on mount.
    const update = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      setInset(kb > 1 ? Math.round(kb) : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
