'use client';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HoverCardArrow,
} from '@/components/ui/hover-card';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip/tooltip';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/types';

interface ScheduledItemsCellProps {
  propertyName: string;
  date: Date;
  tasks: (Task & { property_name: string })[];
  projects?: never[];
  viewMode?: 'week' | 'month';
  expanded?: boolean;
  onTaskClick?: (task: Task) => void;
}

export const marbleBackground: Record<string, string> = {
  not_started: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.35) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.18) 10%, transparent 40%, rgba(255,255,255,0.12) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #A78BFA`,
  in_progress: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.18) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #6366F1`,
  paused: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #8B7FA8`,
  complete: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.12) 10%, transparent 40%, rgba(255,255,255,0.08) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #4C4869`,
};

const getRowStyles = (status: string) => {
  const base = 'relative overflow-hidden rounded-lg';
  switch (status) {
    case 'complete':
      return `${base} bg-[rgba(76,72,105,0.06)] dark:bg-[rgba(76,72,105,0.12)] border border-[rgba(76,72,105,0.14)] dark:border-[rgba(76,72,105,0.22)]`;
    case 'in_progress':
      return `${base} bg-[rgba(99,102,241,0.06)] dark:bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.16)] dark:border-[rgba(99,102,241,0.25)]`;
    case 'paused':
      return `${base} bg-[rgba(139,133,168,0.06)] dark:bg-[rgba(139,133,168,0.10)] border border-[rgba(139,133,168,0.14)] dark:border-[rgba(139,133,168,0.22)]`;
    case 'contingent':
      return `${base} bg-white/45 dark:bg-white/[0.03] border border-dashed border-[rgba(30,25,20,0.15)] dark:border-[rgba(255,255,255,0.10)]`;
    default:
      return `${base} bg-[rgba(167,139,250,0.06)] dark:bg-[rgba(167,139,250,0.10)] border border-[rgba(167,139,250,0.14)] dark:border-[rgba(167,139,250,0.22)]`;
  }
};

interface UniqueUser {
  user_id: string;
  name: string;
  avatar?: string;
}

// Get unique users from tasks only
const getTaskUsers = (tasks: Task[]): UniqueUser[] => {
  const userMap = new Map<string, UniqueUser>();
  tasks.forEach((task) => {
    task.assigned_users?.forEach((user) => {
      if (user.user_id && !userMap.has(user.user_id)) {
        userMap.set(user.user_id, {
          user_id: user.user_id,
          name: user.name || 'Unknown',
          avatar: user.avatar,
        });
      }
    });
  });
  return Array.from(userMap.values());
};


// Compute aggregate status for a group of tasks (same logic as turnover cards)
const getTaskFolderStatus = (tasks: Task[]): 'not_started' | 'in_progress' | 'paused' | 'complete' | 'no_tasks' => {
  const activeTasks = tasks.filter(t => t.status !== 'contingent');
  const total = activeTasks.length;
  if (total === 0) return 'no_tasks';
  const completed = activeTasks.filter(t => t.status === 'complete').length;
  if (completed === total) return 'complete';
  const inProgress = activeTasks.filter(t => t.status === 'in_progress').length;
  if (inProgress > 0) return 'in_progress';
  const paused = activeTasks.filter(t => t.status === 'paused').length;
  if (paused > 0 || completed > 0) return 'paused';
  return 'not_started';
};


// Reusable avatar group component - shows 1 avatar with +N overlay badge
const AvatarGroup = ({ 
  users, 
}: { 
  users: UniqueUser[]; 
}) => {
  if (users.length === 0) return null;
  
  const firstUser = users[0];
  const overflowCount = users.length - 1;

  return (
    <Tooltip>
      <TooltipTrigger>
        <div className="relative">
          <UserAvatar
            src={firstUser.avatar}
            name={firstUser.name}
            size="sm"
          />
          {overflowCount > 0 && (
            <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-neutral-700 dark:bg-neutral-200 text-[9px] font-medium text-white dark:text-neutral-800 border border-white dark:border-neutral-900">
              +{overflowCount}
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipPositioner sideOffset={4}>
          <TooltipPopup className="text-xs">
            {users.map(u => u.name).join(', ')}
          </TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
};

export function ScheduledItemsCell({
  propertyName,
  date,
  tasks,
  viewMode = 'week',
  expanded = false,
  onTaskClick,
}: ScheduledItemsCellProps) {
  // Format the cell date as YYYY-MM-DD for direct string comparison
  const cellDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  // Filter tasks scheduled for this property + date
  const scheduledTasks = tasks.filter(
    (t) =>
      t.property_name === propertyName &&
      t.scheduled_date &&
      t.scheduled_date === cellDateStr
  );

  // Split tasks into approved vs contingent for icon styling
  const approvedTasks = scheduledTasks.filter(t => t.status !== 'contingent');
  const contingentTasks = scheduledTasks.filter(t => t.status === 'contingent');
  const hasApproved = approvedTasks.length > 0;
  const hasContingent = contingentTasks.length > 0;

  // Aggregate status for the task icon folder (same logic as turnover cards)
  const taskFolderStatus = getTaskFolderStatus(scheduledTasks);

  if (scheduledTasks.length === 0) {
    return null;
  }

  const taskUsers = getTaskUsers(scheduledTasks);

  // Hide avatars in month view (not enough space)
  const showAvatars = viewMode === 'week';

  return (
    <TooltipProvider delay={200}>
      <div className="absolute bottom-0.5 left-0.5 flex items-center gap-1 z-[5]">
        {/* Tasks Icon + Task Assignees */}
        {scheduledTasks.length > 0 && (
          <>
            {expanded ? (
              /* When property is expanded, show icon only — no hover dropdown */
              <div
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded transition-colors relative overflow-hidden shadow-sm text-white",
                  !hasApproved && hasContingent && "border-[1.5px] border-dashed border-[rgba(30,25,20,0.25)] dark:border-[rgba(255,255,255,0.25)] bg-white dark:bg-[#1a1a1d] text-[#1a1a18] dark:text-white",
                  hasApproved && taskFolderStatus === 'no_tasks' && "bg-white dark:bg-[#1a1a1d] border border-[rgba(30,25,20,0.12)] dark:border-[rgba(255,255,255,0.12)] text-[#1a1a18] dark:text-white",
                  hasApproved && hasContingent && "border-[1.5px] border-dashed border-[rgba(30,25,20,0.35)] dark:border-[rgba(255,255,255,0.35)]",
                )}
                style={hasApproved && taskFolderStatus !== 'no_tasks' ? { background: marbleBackground[taskFolderStatus] || marbleBackground.not_started } : undefined}
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
              </div>
            ) : (
              <HoverCard openDelay={0} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <div
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors relative overflow-hidden shadow-sm text-white hover:brightness-110",
                      !hasApproved && hasContingent && "border-[1.5px] border-dashed border-[rgba(30,25,20,0.25)] dark:border-[rgba(255,255,255,0.25)] bg-white dark:bg-[#1a1a1d] text-[#1a1a18] dark:text-white hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.08)]",
                      hasApproved && taskFolderStatus === 'no_tasks' && "bg-white dark:bg-[#1a1a1d] border border-[rgba(30,25,20,0.12)] dark:border-[rgba(255,255,255,0.12)] text-[#1a1a18] dark:text-white hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.08)]",
                      hasApproved && hasContingent && "border-[1.5px] border-dashed border-[rgba(30,25,20,0.35)] dark:border-[rgba(255,255,255,0.35)]",
                    )}
                    style={hasApproved && taskFolderStatus !== 'no_tasks' ? { background: marbleBackground[taskFolderStatus] || marbleBackground.not_started } : undefined}
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                  </div>
                </HoverCardTrigger>
                <HoverCardContent side="bottom" align="start" sideOffset={4} collisionPadding={16} className="w-72 p-0 bg-white dark:bg-[#141418] border border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.08)] shadow-lg">
                  <HoverCardArrow className="fill-white dark:fill-[#141418]" />
                  <div className="p-2 flex flex-col gap-2 max-h-48 overflow-y-auto subtle-scrollbar">
                    {scheduledTasks.map((task) => (
                      <div
                        key={task.task_id}
                        className={cn(
                          "flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99]",
                          getRowStyles(task.status)
                        )}
                        onClick={() => onTaskClick?.(task)}
                      >
                        <span className="truncate text-sm">{task.title || task.template_name || task.type}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {task.assigned_users?.slice(0, 1).map((user) => (
                            <div key={user.user_id} className="relative">
                              <UserAvatar
                                src={user.avatar}
                                name={user.name || 'Unknown'}
                                size="xs"
                              />
                              {(task.assigned_users?.length ?? 0) > 1 && (
                                <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-neutral-700 dark:bg-neutral-200 text-[9px] font-medium text-white dark:text-neutral-800 border border-white dark:border-neutral-900">
                                  +{(task.assigned_users?.length ?? 0) - 1}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
            {showAvatars && <AvatarGroup users={taskUsers} />}
          </>
        )}

      </div>
    </TooltipProvider>
  );
}
