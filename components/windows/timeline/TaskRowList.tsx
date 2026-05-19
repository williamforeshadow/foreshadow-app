'use client';

// Shared lightweight task-row list used by BOTH the Timeline grid cell hover
// dropdown (ScheduledItemsCell) and the chevron-expand property detail row
// (TimelineWindow), so the two render identically. Plain rows — status dot +
// title + assignee avatar — no per-row card/border/marble-pill chrome.

import { UserAvatar } from '@/components/ui/user-avatar';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/types';
import { marbleBackground } from './timelineStatus';

export function TaskRowList({
  tasks,
  onTaskClick,
}: {
  tasks: (Task & { property_name?: string })[];
  onTaskClick: (task: Task) => void;
}) {
  return (
    <div className="flex flex-col">
      {tasks.map((task) => {
        const isContingent = task.status === 'contingent';
        const extra = (task.assigned_users?.length ?? 0) - 1;
        return (
          <div
            key={task.task_id}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
              'hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[var(--timeline-hover)]',
            )}
            // HoverCardContent / portals route synthetic events through the
            // component tree, so stop propagation to avoid the date cell's
            // reservation onClick clobbering the task panel we're opening.
            onClick={(e) => {
              e.stopPropagation();
              onTaskClick(task);
            }}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                isContingent &&
                  'border border-dashed border-[rgba(30,25,20,0.4)] dark:border-[rgba(255,255,255,0.4)]',
              )}
              style={
                isContingent
                  ? undefined
                  : {
                      background:
                        marbleBackground[task.status] || marbleBackground.not_started,
                    }
              }
            />
            <span className="truncate text-sm flex-1 min-w-0">
              {task.title || task.template_name || 'Task'}
            </span>
            {task.assigned_users?.slice(0, 1).map((user) => (
              <div key={user.user_id} className="relative shrink-0">
                <UserAvatar src={user.avatar} name={user.name || 'Unknown'} size="xs" />
                {extra > 0 && (
                  <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-neutral-700 dark:bg-neutral-200 text-[9px] font-medium text-white dark:text-neutral-800 border border-white dark:border-[var(--timeline-surface-3)]">
                    +{extra}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
