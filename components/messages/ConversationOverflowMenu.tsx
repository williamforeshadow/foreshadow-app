'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical,
  CheckCircle2,
  RotateCcw,
  Mail,
  GraduationCap,
} from 'lucide-react';

/**
 * Mobile-only overflow (•••) menu for a conversation, rendered in the
 * MobileRouteShell top bar next to the "details" button. Holds the status
 * actions that live in the thread header on desktop (complete/reopen +
 * mark-unread) plus the "Turn into training" entry (which on desktop is the
 * grad-cap in the thread header). Selecting an item closes the menu.
 *
 * "Turn into training" starts selection mode inside ConversationThread via a
 * signal the parent bumps — the confirm/cancel controls then appear in-thread.
 */
export function ConversationOverflowMenu({
  isComplete,
  onToggleComplete,
  onMarkUnread,
  canTrain,
  onTurnIntoTraining,
}: {
  /** True when the conversation is in the "complete" app_status. */
  isComplete: boolean;
  onToggleComplete: () => void;
  onMarkUnread: () => void;
  /** Whether "Turn into training" is available (thread has messages). */
  canTrain: boolean;
  onTurnIntoTraining: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape (the backdrop handles outside taps).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-[rgba(30,25,20,0.04)] dark:text-[#a09e9a] dark:hover:bg-[rgba(255,255,255,0.04)]"
      >
        <MoreVertical className="h-[22px] w-[22px]" strokeWidth={1.75} />
      </button>

      {open ? (
        <>
          {/* Tap-away catcher */}
          <div
            className="fixed inset-0 z-[59]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-[60] mt-1 min-w-[188px] overflow-hidden rounded-xl border border-[var(--surface-elevated-line)] bg-white py-1 shadow-xl dark:bg-card"
          >
            <MenuItem
              icon={
                isComplete ? (
                  <RotateCcw className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )
              }
              label={isComplete ? 'Reopen' : 'Mark complete'}
              onClick={run(onToggleComplete)}
            />
            <MenuItem
              icon={<Mail className="h-4 w-4" />}
              label="Mark unread"
              onClick={run(onMarkUnread)}
            />
            {canTrain ? (
              <MenuItem
                icon={<GraduationCap className="h-4 w-4" />}
                label="Turn into training"
                onClick={run(onTurnIntoTraining)}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-black/[0.04] active:bg-black/[0.06] dark:hover:bg-white/[0.05] dark:active:bg-white/[0.07]"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      {label}
    </button>
  );
}
