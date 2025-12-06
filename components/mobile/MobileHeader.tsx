'use client';

import { memo } from 'react';
import type { MobileTab } from './MobileNav';

interface MobileHeaderProps {
  activeTab: MobileTab;
  title?: string;
  rightAction?: React.ReactNode;
}

// Header is now minimal - each view manages its own title
const MobileHeader = memo(function MobileHeader({ 
  activeTab, 
  title,
  rightAction 
}: MobileHeaderProps) {
  // Return null - we're removing the top header entirely
  // Each mobile view will handle its own sticky header
  return null;
});

export default MobileHeader;

