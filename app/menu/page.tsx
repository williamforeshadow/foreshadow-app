'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/lib/useIsMobile';
import { MobileMenuView } from '@/components/mobile/MobileMenuView';

// The "Menu" tab-root, mobile-only. Desktop has the full sidebar, so /menu is
// meaningless there — bounce to home.
export default function MenuPage() {
  const isMobile = useIsMobile();
  const router = useRouter();

  useEffect(() => {
    if (isMobile === false) router.replace('/');
  }, [isMobile, router]);

  if (!isMobile) return null;
  return <MobileMenuView />;
}
