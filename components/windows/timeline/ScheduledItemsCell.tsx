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
import DiamondIcon from '@/components/icons/AssignmentIcon';
import HexagonIcon from '@/components/icons/HammerIcon';
import { cn } from '@/lib/utils';
import type { Task, Project } from '@/lib/types';

interface ScheduledItemsCellProps {
  propertyName: string;
  date: Date;
  tasks: (Task & { property_name: string })[];
  projects: Project[];
  viewMode?: 'week' | 'month';
  onTaskClick?: (task: Task) => void;
  onProjectClick?: (project: Project) => void;
}

// Status-colored row styles — matches TaskDetailPanel / TurnoverTaskList card colors
const getRowStyles = (status: string) => {
  const base = 'glass-card glass-sheen relative overflow-hidden rounded-lg';
  switch (status) {
    case 'complete':
      return `${base} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`;
    case 'in_progress':
      return `${base} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'paused':
      return `${base} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'contingent':
      return `${base} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`;
    case 'on_hold':
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
    default: // not_started, reopened, etc.
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
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

// Get unique users from projects only
const getProjectUsers = (projects: Project[]): UniqueUser[] => {
  const userMap = new Map<string, UniqueUser>();
  projects.forEach((project) => {
    project.project_assignments?.forEach((assignment) => {
      const userId = assignment.user_id;
      const user = assignment.user;
      if (userId && !userMap.has(userId)) {
        userMap.set(userId, {
          user_id: userId,
          name: user?.name || 'Unknown',
          avatar: user?.avatar,
        });
      }
    });
  });
  return Array.from(userMap.values());
};

// Compute aggregate status for a group of tasks (same logic as turnover cards)
const getTaskFolderStatus = (tasks: Task[]): 'not_started' | 'in_progress' | 'complete' | 'no_tasks' => {
  const activeTasks = tasks.filter(t => t.status !== 'contingent');
  const total = activeTasks.length;
  if (total === 0) return 'no_tasks';
  const completed = activeTasks.filter(t => t.status === 'complete').length;
  if (completed === total) return 'complete';
  const inProgress = activeTasks.filter(t => t.status === 'in_progress' || t.status === 'paused').length;
  if (inProgress > 0 || completed > 0) return 'in_progress';
  return 'not_started';
};

// Compute aggregate status for a group of projects
const getProjectFolderStatus = (projects: Project[]): 'not_started' | 'in_progress' | 'complete' | 'no_tasks' => {
  const total = projects.length;
  if (total === 0) return 'no_tasks';
  const completed = projects.filter(p => p.status === 'complete').length;
  if (completed === total) return 'complete';
  const inProgress = projects.filter(p => p.status === 'in_progress' || p.status === 'on_hold').length;
  if (inProgress > 0 || completed > 0) return 'in_progress';
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
  projects,
  viewMode = 'week',
  onTaskClick,
  onProjectClick,
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

  // Filter projects scheduled for this property + date
  const scheduledProjects = projects.filter(
    (p) =>
      p.property_name === propertyName &&
      p.scheduled_date &&
      p.scheduled_date === cellDateStr
  );

  // Nothing scheduled? Don't render anything
  if (scheduledTasks.length === 0 && scheduledProjects.length === 0) {
    return null;
  }

  // Get users for tasks and projects separately
  const taskUsers = getTaskUsers(scheduledTasks);
  const projectUsers = getProjectUsers(scheduledProjects);

  // Hide avatars in month view (not enough space)
  const showAvatars = viewMode === 'week';

  return (
    <TooltipProvider delay={200}>
      <div className="absolute bottom-0.5 left-0.5 flex items-center gap-1 z-20">
        {/* Tasks Icon + Task Assignees */}
        {scheduledTasks.length > 0 && (
          <>
            <HoverCard openDelay={0} closeDelay={100}>
              <HoverCardTrigger asChild>
                <div
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors glass-sheen relative overflow-hidden shadow-sm",
                    // Contingent-only: dashed neutral outline
                    !hasApproved && hasContingent && "border-[1.5px] border-dashed border-neutral-400/70 text-white dark:text-white bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700",
                    // Status-driven glass colors (when approved tasks exist) — icon stays white
                    hasApproved && taskFolderStatus === 'not_started' && "bg-amber-100 dark:bg-amber-900 border border-amber-200/40 dark:border-amber-400/20 text-white dark:text-white hover:bg-amber-200 dark:hover:bg-amber-800",
                    hasApproved && taskFolderStatus === 'in_progress' && "bg-indigo-100 dark:bg-indigo-900 border border-indigo-300/40 dark:border-indigo-400/20 text-white dark:text-white hover:bg-indigo-200 dark:hover:bg-indigo-800",
                    hasApproved && taskFolderStatus === 'complete' && "bg-emerald-100 dark:bg-emerald-900 border border-emerald-200/40 dark:border-emerald-400/20 text-white dark:text-white hover:bg-emerald-200 dark:hover:bg-emerald-800",
                    hasApproved && taskFolderStatus === 'no_tasks' && "bg-neutral-100 dark:bg-neutral-800 border border-neutral-300/35 dark:border-white/12 text-white dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700",
                    // Dashed border overlay when mixed (approved + contingent)
                    hasApproved && hasContingent && "border-[1.5px] border-dashed border-neutral-400/70 dark:border-neutral-400/70",
                  )}
                >
                  <DiamondIcon size={14} />
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="bottom" align="start" sideOffset={4} collisionPadding={16} className="w-72 p-0 glass-card bg-white/90 dark:bg-neutral-900/95 border-white/30 dark:border-white/10">
                <HoverCardArrow className="fill-white/90 dark:fill-neutral-900" />
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
                      <span className="truncate text-sm">{task.template_name || task.type}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {task.assigned_users?.slice(0, 1).map((user) => (
                          <UserAvatar
                            key={user.user_id}
                            src={user.avatar}
                            name={user.name || 'Unknown'}
                            size="xs"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
            {showAvatars && <AvatarGroup users={taskUsers} />}
          </>
        )}

        {/* Projects Icon + Project Assignees */}
        {scheduledProjects.length > 0 && (() => {
          const projectFolderStatus = getProjectFolderStatus(scheduledProjects);
          return (
          <>
            <HoverCard openDelay={0} closeDelay={100}>
              <HoverCardTrigger asChild>
                <div
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors glass-sheen relative overflow-hidden shadow-sm",
                    projectFolderStatus === 'not_started' && "bg-amber-100 dark:bg-amber-900 border border-amber-200/40 dark:border-amber-400/20 text-white dark:text-white hover:bg-amber-200 dark:hover:bg-amber-800",
                    projectFolderStatus === 'in_progress' && "bg-indigo-100 dark:bg-indigo-900 border border-indigo-300/40 dark:border-indigo-400/20 text-white dark:text-white hover:bg-indigo-200 dark:hover:bg-indigo-800",
                    projectFolderStatus === 'complete' && "bg-emerald-100 dark:bg-emerald-900 border border-emerald-200/40 dark:border-emerald-400/20 text-white dark:text-white hover:bg-emerald-200 dark:hover:bg-emerald-800",
                    projectFolderStatus === 'no_tasks' && "bg-neutral-100 dark:bg-neutral-800 border border-neutral-300/35 dark:border-white/12 text-white dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700",
                  )}
                >
                  <HexagonIcon size={14} />
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="bottom" align="start" sideOffset={4} collisionPadding={16} className="w-72 p-0 glass-card bg-white/90 dark:bg-neutral-900/95 border-white/30 dark:border-white/10">
                <HoverCardArrow className="fill-white/90 dark:fill-neutral-900" />
                <div className="p-2 flex flex-col gap-2 max-h-48 overflow-y-auto subtle-scrollbar">
                  {scheduledProjects.map((project) => (
                    <div
                      key={project.id}
                      className={cn(
                        "flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99]",
                        getRowStyles(project.status)
                      )}
                      onClick={() => onProjectClick?.(project)}
                    >
                      <span className="truncate text-sm">{project.title}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {project.project_assignments?.slice(0, 1).map((assignment) => (
                          <UserAvatar
                            key={assignment.user_id}
                            src={assignment.user?.avatar}
                            name={assignment.user?.name || 'Unknown'}
                            size="xs"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
            {showAvatars && <AvatarGroup users={projectUsers} />}
          </>
          );
        })()}
      </div>
    </TooltipProvider>
  );
}
