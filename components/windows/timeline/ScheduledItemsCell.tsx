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
import AssignmentIcon from '@/components/icons/AssignmentIcon';
import HammerIcon from '@/components/icons/HammerIcon';
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
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'paused':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    case 'reopened':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    default: // not_started
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  }
};

const getProjectStatusStyles = (status: string) => {
  switch (status) {
    case 'complete':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'on_hold':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    default: // not_started
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
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

  // Determine icon variant: approved-only, contingent-only, or mixed
  const taskIconVariant: 'approved' | 'mixed' | 'contingent' =
    approvedTasks.length > 0 && contingentTasks.length > 0
      ? 'mixed'
      : contingentTasks.length > 0
        ? 'contingent'
        : 'approved';

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
            <HoverCard openDelay={0} closeDelay={0}>
              <HoverCardTrigger asChild>
                <div
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors",
                    taskIconVariant === 'approved' && "bg-blue-500/80 text-white hover:bg-blue-600",
                    taskIconVariant === 'contingent' && "border-[1.5px] border-dashed border-blue-400/70 text-blue-400 bg-blue-400/10 hover:bg-blue-400/20",
                    taskIconVariant === 'mixed' && "text-white hover:brightness-110",
                  )}
                  style={taskIconVariant === 'mixed' ? {
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.8) 50%, rgba(147,197,253,0.15) 50%)',
                    border: '1.5px dashed rgba(96,165,250,0.6)',
                  } : undefined}
                >
                  <AssignmentIcon size={14} />
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="start" sideOffset={-8} className="w-72 p-0">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Scheduled Tasks ({scheduledTasks.length}) — {formatDateHeader(date)}
                  </p>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto subtle-scrollbar">
                    {scheduledTasks.map((task) => (
                      <div
                        key={task.task_id}
                        className={cn(
                          "flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer transition-colors",
                          task.status === 'contingent'
                            ? "border-l-2 border-dashed border-blue-400/50 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 text-muted-foreground"
                            : "border-l-2 border-transparent hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        )}
                        onClick={() => onTaskClick?.(task)}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-sm">{task.template_name || task.type}</span>
                          {task.status === 'contingent' && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100/50 dark:bg-blue-900/20 text-blue-500/70 dark:text-blue-400/60 whitespace-nowrap flex-shrink-0">
                              contingent
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {task.assigned_users?.slice(0, 3).map((user) => (
                            <UserAvatar
                              key={user.user_id}
                              src={user.avatar}
                              name={user.name || 'Unknown'}
                              size="xs"
                            />
                          ))}
                          {(task.assigned_users?.length || 0) > 3 && (
                            <span className="text-[10px] text-muted-foreground ml-0.5">
                              +{(task.assigned_users?.length || 0) - 3}
                            </span>
                          )}
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
        {scheduledProjects.length > 0 && (
          <>
            <HoverCard openDelay={0} closeDelay={0}>
              <HoverCardTrigger asChild>
                <div className="flex items-center justify-center w-6 h-6 rounded bg-amber-500/80 text-white cursor-pointer hover:bg-amber-600">
                  <HammerIcon size={14} />
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="start" sideOffset={-8} className="w-72 p-0">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Scheduled Projects ({scheduledProjects.length}) — {formatDateHeader(date)}
                  </p>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto subtle-scrollbar">
                    {scheduledProjects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 border-l-2 border-transparent hover:border-amber-500 transition-colors"
                        onClick={() => onProjectClick?.(project)}
                      >
                        <span className="truncate text-sm">{project.title}</span>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {project.project_assignments?.slice(0, 3).map((assignment) => (
                            <UserAvatar
                              key={assignment.user_id}
                              src={assignment.user?.avatar}
                              name={assignment.user?.name || 'Unknown'}
                              size="xs"
                            />
                          ))}
                          {(project.project_assignments?.length || 0) > 3 && (
                            <span className="text-[10px] text-muted-foreground ml-0.5">
                              +{(project.project_assignments?.length || 0) - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>
            {showAvatars && <AvatarGroup users={projectUsers} />}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
