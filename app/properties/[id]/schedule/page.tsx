'use client';

// Placeholder for the per-property Schedule view. The page shell + primary
// tab strip comes from `app/properties/[id]/layout.tsx` → PropertyShell; this
// component owns the tab body.
//
// Future scope: reservations filtered by property_id rendered as a calendar
// or vertical timeline. Wire-up will follow the user's design pass.
export default function PropertyScheduleTab() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[760px] mx-auto px-5 sm:px-8 pt-10 sm:pt-16 pb-16">
        <div className="flex flex-col items-center text-center gap-2 py-16">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
            Schedule
          </div>
          <p className="text-[14px] text-neutral-500 dark:text-[#a09e9a] max-w-sm">
            Per-property schedule view is coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
