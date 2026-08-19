'use client';

import { useState } from 'react';
import {
  MoreVertical,
  CheckCircle2,
  RotateCcw,
  Mail,
  GraduationCap,
} from 'lucide-react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import { ConciergeToggleIcon } from '@/components/messages/ConciergeToggleIcon';

/**
 * Overflow (•••) menu for a conversation, rendered in the mobile top bar next
 * to the "details" button. Holds the status actions that live in the thread
 * header on desktop (complete/reopen + mark-unread) plus the "Turn into
 * training" entry (which on desktop is the grad-cap in the thread header).
 *
 * Standard picker surface: bottom drawer on mobile, anchored popover if it
 * ever renders on desktop. Selecting an item applies and closes.
 *
 * "Turn into training" starts selection mode inside ConversationThread via a
 * signal the parent bumps — the confirm/cancel controls then appear in-thread.
 */
export function ConversationOverflowMenu({
  isComplete,
  onToggleComplete,
  onMarkUnread,
  conciergeEnabled,
  onToggleConcierge,
  canTrain,
  onTurnIntoTraining,
}: {
  /** True when the conversation is in the "complete" app_status. */
  isComplete: boolean;
  onToggleComplete: () => void;
  onMarkUnread: () => void;
  /** True when the concierge is active on this conversation. */
  conciergeEnabled: boolean;
  onToggleConcierge: () => void;
  /** Whether "Turn into training" is available (thread has messages). */
  canTrain: boolean;
  onTurnIntoTraining: () => void;
}) {
  const [open, setOpen] = useState(false);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const iconWrap = 'shrink-0 text-muted-foreground';

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={setOpen}
      title="Conversation"
      align="end"
      trigger={
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More actions"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-[rgba(30,25,20,0.04)] dark:text-[#a09e9a] dark:hover:bg-[rgba(255,255,255,0.04)]"
        >
          <MoreVertical className="h-[22px] w-[22px]" strokeWidth={1.75} />
        </button>
      }
    >
      <div className="pb-1">
        <TaskOptionRow
          onSelect={run(onToggleComplete)}
          leading={
            <span className={iconWrap}>
              {isComplete ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
            </span>
          }
        >
          {isComplete ? 'Reopen' : 'Mark complete'}
        </TaskOptionRow>
        <TaskOptionRow
          onSelect={run(onMarkUnread)}
          leading={
            <span className={iconWrap}>
              <Mail className="h-4 w-4" />
            </span>
          }
        >
          Mark unread
        </TaskOptionRow>
        <TaskOptionRow
          onSelect={run(onToggleConcierge)}
          leading={
            <span className={iconWrap}>
              <ConciergeToggleIcon enabled={conciergeEnabled} />
            </span>
          }
        >
          {conciergeEnabled ? 'Turn off concierge' : 'Turn on concierge'}
        </TaskOptionRow>
        {canTrain ? (
          <TaskOptionRow
            onSelect={run(onTurnIntoTraining)}
            leading={
              <span className={iconWrap}>
                <GraduationCap className="h-4 w-4" />
              </span>
            }
          >
            Turn into training
          </TaskOptionRow>
        ) : null}
      </div>
    </AdaptivePicker>
  );
}
