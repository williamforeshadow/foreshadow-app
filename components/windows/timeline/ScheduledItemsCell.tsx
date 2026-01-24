'use client';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import AssignmentIcon from '@/components/icons/AssignmentIcon';
import HammerIcon from '@/components/icons/HammerIcon';
import type { Task, Project } from '@/lib/types';

interface ScheduledItemsCellProps {
  propertyName: string;
  date: Date;
  tasks: (Task & { property_name: string })[];
  projects: Project[];
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

export function ScheduledItemsCell({
  propertyName,
  date,
  tasks,
  projects,
  onTaskClick,
  onProjectClick,
}: ScheduledItemsCellProps) {
  // Filter tasks scheduled for this property + date
  const scheduledTasks = tasks.filter(
    (t) =>
      t.property_name === propertyName &&
      t.scheduled_start &&
      isSameDay(new Date(t.scheduled_start), date)
  );

  // Filter projects scheduled for this property + date
  const scheduledProjects = projects.filter(
    (p) =>
      p.property_name === propertyName &&
      p.scheduled_start &&
      isSameDay(new Date(p.scheduled_start), date)
  );

  // Nothing scheduled? Don't render anything
  if (scheduledTasks.length === 0 && scheduledProjects.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 z-20">
      {/* Tasks Icon with HoverCard */}
      {scheduledTasks.length > 0 && (
        <HoverCard openDelay={0} closeDelay={0}>
          <HoverCardTrigger asChild>
            <div className="flex items-center justify-center w-4 h-4 rounded bg-blue-500/80 text-white cursor-pointer hover:bg-blue-600">
              <AssignmentIcon size={10} />
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
                    className="flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 border-l-2 border-transparent hover:border-blue-500 transition-colors"
                    onClick={() => onTaskClick?.(task)}
                  >
                    <span className="truncate text-sm">{task.template_name || task.type}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${getTaskStatusStyles(task.status)}`}>
                      {task.status?.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      )}

      {/* Projects Icon with HoverCard */}
      {scheduledProjects.length > 0 && (
        <HoverCard openDelay={0} closeDelay={0}>
          <HoverCardTrigger asChild>
            <div className="flex items-center justify-center w-4 h-4 rounded bg-amber-500/80 text-white cursor-pointer hover:bg-amber-600">
              <HammerIcon size={10} />
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
                    <span className={`text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${getProjectStatusStyles(project.status)}`}>
                      {project.status?.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}
