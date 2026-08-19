'use client';

import { Drawer } from 'vaul';

// Mobile bottom-drawer chrome for the shared <DayDetailPanel /> — used by the
// Schedule tab's grid and the property calendar so both day drawers are the
// same physical object: vaul drag/flick to dismiss (arbitrated against the
// panel's own task-list scroll), scrim tap, Escape. No X button, per the
// drawer standard — pass `hideClose` to the panel inside.
//
// Desktop keeps its right-column panel; this wrapper is mobile-only chrome.
export function DayDetailDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/20 dark:bg-black/40" />
        <Drawer.Content
          aria-describedby={undefined}
          className="safe-area-bottom fixed inset-x-0 bottom-0 z-[60] flex max-h-[75vh] flex-col rounded-t-2xl border-t border-[rgba(30,25,20,0.08)] bg-white shadow-2xl outline-none dark:border-white/10 dark:bg-background"
        >
          <Drawer.Title className="sr-only">Day details</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-black/15 dark:bg-white/20" />
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
