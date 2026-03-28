'use client';

import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Returns `null` during SSR / before first client paint (unknown),
 * then `true` or `false` once the viewport is measured.
 * Callers should treat `null` as "not ready" and render nothing or a skeleton.
 */
export function useIsMobile(): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return isMobile;
}

// Hook to get current viewport dimensions
export function useViewportSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateSize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);

    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, []);

  return size;
}

