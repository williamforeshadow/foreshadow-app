'use client';

import { Drawer } from 'vaul';
import { ReservationContextPanel } from '@/components/reservations/ReservationContextPanel';
import type { ProposedTaskData } from '@/components/messages/ProposedTask';
import type { ReservationContextTask } from '@/components/reservations/useReservationContext';
import type { ConversationRow } from '@/lib/conversations';

// Mobile "top sheet" for the conversation's reservation context — the same
// ReservationContextPanel the desktop right rail renders (reservation summary,
// sentiment, associated + proposed tasks). Slides down from the top over the
// thread, opened from the top-bar "details" button.
//
// Built on vaul (direction="top") so it's a physical object like every other
// drawer: drag it back up to dismiss (vaul arbitrates against the inner
// scroll), or tap the scrim / press Escape. The grab handle sits on its
// bottom edge — the pullable edge of a top sheet.
//
// Opening a task or a proposal from inside the sheet is the parent's job (it
// owns the full-screen task / proposal overlays); the parent closes the sheet
// as part of those handlers so overlays never stack behind it.

export function MobileConversationDetailSheet({
  open,
  onClose,
  conversation,
  proposedTasks,
  tasksRefreshKey,
  onOpenTask,
  onOpenProposal,
  onProposedTaskChange,
}: {
  open: boolean;
  onClose: () => void;
  conversation: ConversationRow | undefined;
  proposedTasks: ProposedTaskData[];
  tasksRefreshKey: number;
  onOpenTask: (task: ReservationContextTask) => void;
  onOpenProposal: (proposal: ProposedTaskData) => void;
  onProposedTaskChange: () => void;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      direction="top"
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Drawer.Content
          aria-describedby={undefined}
          aria-label="Reservation details"
          className="safe-area-top fixed inset-x-0 top-0 z-[60] flex max-h-[88dvh] flex-col overflow-hidden rounded-b-[1.5rem] border-b border-[var(--surface-elevated-line)] bg-white shadow-2xl outline-none dark:bg-card"
        >
          <div className="msg-divider flex shrink-0 items-center border-b px-4 py-2.5">
            <Drawer.Title asChild>
              <h2 className="text-sm font-semibold text-foreground">Details</h2>
            </Drawer.Title>
          </div>

          {/* The scroll container. It — not the shared panel's own `h-full`
              overflow — owns the scroll: under a flex parent with min-h-0 the
              panel's percentage height collapses to its content height on iOS, so
              its inner overflow never engages and the details get clipped. Making
              this wrapper the scroller sidesteps that entirely. */}
          <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar [-webkit-overflow-scrolling:touch]">
            <ReservationContextPanel
              conversation={conversation}
              proposedTasks={proposedTasks}
              tasksRefreshKey={tasksRefreshKey}
              onOpenTask={onOpenTask}
              onOpenProposal={onOpenProposal}
              onProposedTaskChange={onProposedTaskChange}
            />
          </div>

          {/* Grab handle on the pullable (bottom) edge. */}
          <div className="mx-auto mb-2 mt-2.5 h-1 w-9 shrink-0 rounded-full bg-black/15 dark:bg-white/20" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
