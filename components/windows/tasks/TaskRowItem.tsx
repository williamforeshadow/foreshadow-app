'use client';

import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { TaskRow } from '@/lib/useTasks';
import type { TaskStatus, TaskType } from '@/lib/types';

// Status badge styles
export const statusStyles: Record<TaskStatus, string> = {
  not_started: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400',
  complete: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400',
  reopened: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400',
};

// Type badge styles
export const typeStyles: Record<TaskType, string> = {
  cleaning: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400',
  maintenance: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
};

interface TaskRowItemProps {
  task: TaskRow;
  isSelected: boolean;
  onSelect: () => void;
}

export const TaskRowItem = memo(function TaskRowItem({ 
  task, 
  isSelected,
  onSelect 
}: TaskRowItemProps) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-6 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700
        hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors
        ${isSelected ? 'bg-amber-50 dark:bg-amber-900/20 border-l-2 border-l-amber-400' : ''}
      `}
    >
      {/* Active/Inactive indicator */}
      <div 
        className={`w-2 h-2 rounded-full shrink-0 ${
          task.isActive 
            ? 'bg-emerald-500' 
            : 'bg-neutral-300 dark:bg-neutral-600'
        }`}
        title={task.isActive ? 'Active turnover' : 'Inactive turnover'}
      />

      {/* Task name */}
      <div className="w-48 min-w-0">
        <div className="font-medium text-sm text-neutral-900 dark:text-white truncate">
          {task.template_name}
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
          {task.property_name}
        </div>
      </div>

      {/* Turnover Window */}
      <div className="w-32 text-xs text-neutral-600 dark:text-neutral-300 shrink-0 text-center">
        {formatDate(task.check_out)} | {formatDate(task.next_check_in)}
      </div>

      {/* Type badge */}
      <div className="w-24">
        <Badge variant="outline" className={`text-xs ${typeStyles[task.type]}`}>
          {task.type}
        </Badge>
      </div>

      {/* Status badge */}
      <div className="w-24">
        <Badge variant="outline" className={`text-xs ${statusStyles[task.status]}`}>
          {task.status.replace('_', ' ')}
        </Badge>
      </div>

      {/* Scheduled/Due date */}
      <div className="w-24 text-xs text-neutral-500 dark:text-neutral-400 text-right shrink-0">
        {task.scheduled_start ? formatDate(task.scheduled_start) : '—'}
      </div>

      {/* Assigned users */}
      <div className="w-24 shrink-0">
        {task.assigned_users.length > 0 ? (
          <div className="flex -space-x-2">
            {task.assigned_users.slice(0, 3).map((user) => (
              <div
                key={user.user_id}
                className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-700 border-2 border-white dark:border-neutral-900 flex items-center justify-center text-[10px] font-medium"
                title={user.name}
              >
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  user.name?.charAt(0)?.toUpperCase() || '?'
                )}
              </div>
            ))}
            {task.assigned_users.length > 3 && (
              <div className="w-6 h-6 rounded-full bg-neutral-300 dark:bg-neutral-600 border-2 border-white dark:border-neutral-900 flex items-center justify-center text-[10px] font-medium">
                +{task.assigned_users.length - 3}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-neutral-400">Unassigned</span>
        )}
      </div>

      {/* Guest name */}
      <div className="w-28 text-xs text-neutral-600 dark:text-neutral-300 truncate">
        {task.guest_name || '—'}
      </div>
    </div>
  );
});

