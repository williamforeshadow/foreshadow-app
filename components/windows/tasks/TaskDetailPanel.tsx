'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TaskRow } from '@/lib/useTasks';
import { statusStyles, typeStyles } from './TaskRowItem';

interface TaskDetailPanelProps {
  task: TaskRow;
  onClose: () => void;
}

export function TaskDetailPanel({ task, onClose }: TaskDetailPanelProps) {
  return (
    <div className="w-1/2 flex flex-col bg-white dark:bg-neutral-900">
      {/* Panel Header */}
      <div className="flex-shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-white">
              {task.template_name}
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {task.property_name}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status & Type */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={typeStyles[task.type]}>
            {task.type}
          </Badge>
          <Badge variant="outline" className={statusStyles[task.status]}>
            {task.status.replace('_', ' ')}
          </Badge>
        </div>

        {/* Details */}
        <div className="space-y-3">
          {task.guest_name && (
            <div>
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Guest</div>
              <div className="text-sm text-neutral-900 dark:text-white">{task.guest_name}</div>
            </div>
          )}

          {task.check_out && (
            <div>
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Check-out</div>
              <div className="text-sm text-neutral-900 dark:text-white">
                {new Date(task.check_out).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
                })}
              </div>
            </div>
          )}

          {task.scheduled_start && (
            <div>
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Scheduled</div>
              <div className="text-sm text-neutral-900 dark:text-white">
                {new Date(task.scheduled_start).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </div>
            </div>
          )}

          {task.assigned_users.length > 0 && (
            <div>
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Assigned to</div>
              <div className="flex flex-wrap gap-2">
                {task.assigned_users.map(user => (
                  <div
                    key={user.user_id}
                    className="flex items-center gap-2 px-2 py-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg"
                  >
                    <div className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[10px] font-medium">
                      {user.avatar ? (
                        <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        user.name?.charAt(0)?.toUpperCase() || '?'
                      )}
                    </div>
                    <span className="text-sm text-neutral-700 dark:text-neutral-300">{user.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Placeholder for future functionality */}
        <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
          <p className="text-xs text-neutral-400 text-center">
            Task actions and form data will be added here
          </p>
        </div>
      </div>
    </div>
  );
}

