'use client';

import PropertyScheduleView from '@/components/properties/schedule/PropertyScheduleView';

// Per-property Schedule tab. The page shell + primary tab strip comes from
// `app/properties/[id]/layout.tsx` → PropertyShell; this component owns the
// tab body, mounting the calendar month view + reservation detail overlay.
export default function PropertyScheduleTab() {
  return <PropertyScheduleView />;
}
