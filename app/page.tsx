'use client';

import { useIsMobile } from '@/lib/useIsMobile';
import DesktopApp from './desktop/DesktopApp';
import MobileApp from './mobile/MobileApp';

export default function HomePage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileApp /> : <DesktopApp />;
}
