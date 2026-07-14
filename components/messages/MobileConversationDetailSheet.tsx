'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ConversationDetailPanel } from '@/components/messages/ConversationDetailPanel';
import type { ProposedTaskData } from '@/components/messages/ProposedTask';
import type { ReservationContextTask } from '@/components/messages/useReservationContext';
import type { ConversationRow } from '@/lib/conversations';

// Mobile "top sheet" for the conversation's reservation context — the same
// ConversationDetailPanel the desktop right rail renders (reservation summary,
// sentiment, associated + proposed tasks). Slides down from the top over the
// thread, opened from the top-bar "details" button. Backdrop tap or the close
// button dismisses it.
//
// Opening a task or a proposal from inside the sheet is the parent's job (it
// owns the full-screen task / proposal overlays); the parent closes the sheet
// as part of those handlers so overlays never stack behind it.

const ANIM_MS = 280;

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
  // Keep the sheet mounted through its exit transition: `shouldRender` gates the
  // DOM, `shown` drives the slide/opacity. Mount-on-open and start-of-exit are
  // render-time adjustments (React's recommended pattern); the deferred flips
  // (enter after paint, unmount after the slide) run in effects via rAF/timeout.
  const [shouldRender, setShouldRender] = useState(open);
  const [shown, setShown] = useState(false);

  if (open && !shouldRender) setShouldRender(true);
  if (!open && shown) setShown(false);

  // Enter: flip `shown` on once the mounted (translated-up) sheet has painted.
  useEffect(() => {
    if (!open) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open]);

  // Exit: unmount after the slide-out transition finishes.
  useEffect(() => {
    if (open || !shouldRender) return;
    const t = setTimeout(() => setShouldRender(false), ANIM_MS);
    return () => clearTimeout(t);
  }, [open, shouldRender]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-[280ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sheet — anchored to the top, slides down. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reservation details"
        className={`safe-area-top absolute inset-x-0 top-0 flex max-h-[88dvh] flex-col rounded-b-[1.5rem] border-b border-[var(--surface-elevated-line)] bg-white shadow-2xl transition-transform duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] dark:bg-card ${
          shown ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="msg-divider flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationDetailPanel
            conversation={conversation}
            proposedTasks={proposedTasks}
            tasksRefreshKey={tasksRefreshKey}
            onOpenTask={onOpenTask}
            onOpenProposal={onOpenProposal}
            onProposedTaskChange={onProposedTaskChange}
          />
        </div>

        {/* Pull tab — visual affordance for the sheet's bottom edge. */}
        <div className="flex shrink-0 items-center justify-center pb-2 pt-1">
          <span className="h-1 w-9 rounded-full bg-black/10 dark:bg-white/15" aria-hidden />
        </div>
      </div>
    </div>
  );
}
