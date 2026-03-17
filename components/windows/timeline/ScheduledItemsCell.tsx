'use client';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
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

// Helper to check if two dates are the same day
const isSameDay = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

// Format date for display
const formatDateHeader = (date: Date) => {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Get status badge styles
const getTaskStatusStyles = (status: string) => {
  switch (status) {
    case 'complete':
      return 'bg-emerald-100/60 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-300/30 dark:border-emerald-500/20';
    case 'in_progress':
      return 'bg-indigo-100/60 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-300/30 dark:border-indigo-500/20';
    case 'paused':
      return 'bg-purple-100/60 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border border-purple-300/30 dark:border-purple-500/20';
    case 'reopened':
      return 'bg-orange-100/60 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-300/30 dark:border-orange-500/20';
    default: // not_started
      return 'bg-amber-100/60 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300/30 dark:border-amber-500/20';
  }
};

const getProjectStatusStyles = (status: string) => {
  switch (status) {
    case 'complete':
      return 'bg-emerald-100/60 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-300/30 dark:border-emerald-500/20';
    case 'in_progress':
      return 'bg-indigo-100/60 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-300/30 dark:border-indigo-500/20';
    case 'on_hold':
      return 'bg-orange-100/60 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-300/30 dark:border-orange-500/20';
    default: // not_started
      return 'bg-amber-100/60 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300/30 dark:border-amber-500/20';
  }
};

// Get status-colored hover styles for task rows
const getTaskRowHoverStyles = (status: string) => {
  switch (status) {
    case 'complete':
      return 'hover:bg-emerald-50/60 dark:hover:bg-emerald-500/10 hover:border-emerald-400/50 dark:hover:border-emerald-400/30';
    case 'in_progress':
      return 'hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 hover:border-indigo-400/50 dark:hover:border-indigo-400/30';
    case 'paused':
      return 'hover:bg-purple-50/60 dark:hover:bg-purple-500/10 hover:border-purple-400/50 dark:hover:border-purple-400/30';
    case 'reopened':
      return 'hover:bg-orange-50/60 dark:hover:bg-orange-500/10 hover:border-orange-400/50 dark:hover:border-orange-400/30';
    case 'contingent':
      return 'hover:bg-white/40 dark:hover:bg-white/[0.06]';
    default: // not_started
      return 'hover:bg-amber-50/60 dark:hover:bg-amber-500/10 hover:border-amber-400/50 dark:hover:border-amber-400/30';
  }
};

// Get status-colored hover styles for project rows
const getProjectRowHoverStyles = (status: string) => {
  switch (status) {
    case 'complete':
      return 'hover:bg-emerald-50/60 dark:hover:bg-emerald-500/10 hover:border-emerald-400/50 dark:hover:border-emerald-400/30';
    case 'in_progress':
      return 'hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 hover:border-indigo-400/50 dark:hover:border-indigo-400/30';
    case 'on_hold':
      return 'hover:bg-orange-50/60 dark:hover:bg-orange-500/10 hover:border-orange-400/50 dark:hover:border-orange-400/30';
    default: // not_started
      return 'hover:bg-amber-50/60 dark:hover:bg-amber-500/10 hover:border-amber-400/50 dark:hover:border-amber-400/30';
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
                    hasApproved && hasContingent && "border-[1.5px] border-dashed",
                  )}
                >
                  <DiamondIcon size={14} />
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="bottom" align="start" sideOffset={2} collisionPadding={16} className="w-72 p-0 glass-card bg-white/90 dark:bg-neutral-900/95 border-white/30 dark:border-white/10">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Scheduled Tasks ({scheduledTasks.length}) — {formatDateHeader(date)}
                  </p>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto subtle-scrollbar">
                    {scheduledTasks.map((task) => (
                      <div
                        key={task.task_id}
                        className={cn(
                          "flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer transition-colors border-l-2",
                          task.status === 'contingent'
                            ? "border-dashed border-neutral-400/40 dark:border-neutral-500/30 text-muted-foreground"
                            : "border-transparent",
                          getTaskRowHoverStyles(task.status)
                        )}
                        onClick={() => onTaskClick?.(task)}
                      >
                        <span className="truncate text-sm">{task.template_name || task.type}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={cn(
                            "text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0 capitalize",
                            task.status === 'complete' && 'bg-emerald-100/60 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-300/30 dark:border-emerald-500/20',
                            task.status === 'in_progress' && 'bg-indigo-100/60 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-300/30 dark:border-indigo-500/20',
                            task.status === 'paused' && 'bg-purple-100/60 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-300/30 dark:border-purple-500/20',
                            task.status === 'reopened' && 'bg-orange-100/60 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-300/30 dark:border-orange-500/20',
                            task.status === 'contingent' && 'bg-neutral-500/10 text-neutral-500 dark:bg-neutral-500/15 dark:text-neutral-400 border-neutral-300/30 dark:border-neutral-500/20',
                            task.status === 'not_started' && 'bg-amber-100/60 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-300/30 dark:border-amber-500/20',
                          )}>
                            {task.status?.replace('_', ' ')}
                          </span>
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
              <HoverCardContent side="bottom" align="start" sideOffset={2} collisionPadding={16} className="w-72 p-0 glass-card bg-white/90 dark:bg-neutral-900/95 border-white/30 dark:border-white/10">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Scheduled Projects ({scheduledProjects.length}) — {formatDateHeader(date)}
                  </p>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto subtle-scrollbar">
                    {scheduledProjects.map((project) => (
                      <div
                        key={project.id}
                        className={cn(
                          "flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer border-l-2 border-transparent transition-colors",
                          getProjectRowHoverStyles(project.status)
                        )}
                        onClick={() => onProjectClick?.(project)}
                      >
                        <span className="truncate text-sm">{project.title}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={cn(
                            "text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0 capitalize",
                            project.status === 'complete' && 'bg-emerald-100/60 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-300/30 dark:border-emerald-500/20',
                            project.status === 'in_progress' && 'bg-indigo-100/60 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-300/30 dark:border-indigo-500/20',
                            project.status === 'on_hold' && 'bg-orange-100/60 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-300/30 dark:border-orange-500/20',
                            (!project.status || project.status === 'not_started') && 'bg-amber-100/60 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-300/30 dark:border-amber-500/20',
                          )}>
                            {project.status?.replace('_', ' ')}
                          </span>
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
