'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import type { Template } from '@/components/DynamicCleaningForm';
import type { TaskRow } from '@/lib/useTasks';
import type { User, TaskStatus } from '@/lib/types';
import { statusStyles, typeStyles } from './TaskRowItem';

interface TaskDetailPanelProps {
  task: TaskRow;
  currentUser: User | null;
  taskTemplates: Record<string, Template>;
  loadingTaskTemplate: string | null;
  onClose: () => void;
  onUpdateStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  onSaveForm: (taskId: string, formData: Record<string, unknown>) => Promise<void>;
  setTask: (task: TaskRow | null) => void;
}

export function TaskDetailPanel({
  task,
  currentUser,
  taskTemplates,
  loadingTaskTemplate,
  onClose,
  onUpdateStatus,
  onSaveForm,
  setTask,
}: TaskDetailPanelProps) {
  const isAssigned = task.assigned_users.some((u) => u.user_id === currentUser?.id);
  const isNotStarted = task.status === 'not_started' || !task.status;

  return (
    <div className="flex flex-col h-full">
      {/* Consolidated Header */}
      <div className="sticky top-0 bg-white dark:bg-neutral-900 z-10 border-b border-neutral-200 dark:border-neutral-700">
        {/* Top Row: Task name & close button */}
        <div className="p-4 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-white truncate">
                {task.template_name || 'Task'}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-neutral-500 truncate">{task.property_name}</span>
                {task.guest_name && (
                  <>
                    <span className="text-neutral-300 dark:text-neutral-600">•</span>
                    <span className="text-sm text-neutral-500 truncate">{task.guest_name}</span>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Info Row: Dates, Status, Type, Assigned */}
        <div className="px-4 pb-3 flex items-center gap-3 text-xs flex-wrap">
          {/* Dates */}
          {task.check_in && (
            <div className="text-center">
              <div className="text-neutral-500 dark:text-neutral-400">In</div>
              <div className="font-medium text-blue-600 dark:text-blue-400">
                {new Date(task.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
          )}
          {task.check_out && (
            <div className="text-center">
              <div className="text-neutral-500 dark:text-neutral-400">Out</div>
              <div className="font-medium text-red-600 dark:text-red-400">
                {new Date(task.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
          )}
          {task.next_check_in && (
            <div className="text-center">
              <div className="text-neutral-500 dark:text-neutral-400">Next In</div>
              <div className="font-medium text-green-600 dark:text-green-400">
                {new Date(task.next_check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
          )}

          {/* Divider */}
          {(task.check_in || task.check_out || task.next_check_in) && (
            <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-700" />
          )}

          {/* Type Badge */}
          <Badge variant="outline" className={typeStyles[task.type]}>
            {task.type}
          </Badge>

          {/* Status Badge */}
          <Badge variant="outline" className={statusStyles[task.status]}>
            {task.status === 'not_started' ? 'Not Started' :
             task.status === 'in_progress' ? 'In Progress' :
             task.status === 'paused' ? 'Paused' :
             task.status === 'complete' ? 'Completed' :
             task.status === 'reopened' ? 'Reopened' :
             'Not Started'}
          </Badge>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Assigned Users */}
          {task.assigned_users.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500 dark:text-neutral-400">Assigned:</span>
              <div className="flex -space-x-1">
                {task.assigned_users.slice(0, 3).map(user => (
                  <div
                    key={user.user_id}
                    className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[9px] font-medium border border-white dark:border-neutral-800"
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
                  <div className="w-5 h-5 rounded-full bg-neutral-300 dark:bg-neutral-600 flex items-center justify-center text-[9px] font-medium border border-white dark:border-neutral-800">
                    +{task.assigned_users.length - 3}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <span className="text-neutral-400">Unassigned</span>
          )}
        </div>
      </div>

      {/* Content - Now goes straight to form/actions */}
      <div className="flex-1 overflow-y-auto p-4">
        {!isAssigned ? (
          /* NOT ASSIGNED - Show info message */
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
              <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-sm text-neutral-500 text-center">
              You are not assigned to this task.<br />
              <span className="text-xs">Only assigned users can interact with the form.</span>
            </p>
          </div>
        ) : isNotStarted ? (
          /* ASSIGNED + NOT STARTED - Show Start button */
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Button
              onClick={async () => {
                await onUpdateStatus(task.task_id, 'in_progress');
                setTask({ ...task, status: 'in_progress' });
              }}
              size="lg"
            >
              Start Task
            </Button>
            <p className="text-xs text-neutral-500">Click to begin working on this task</p>
          </div>
        ) : (
          /* ASSIGNED + ACTIVE - Show form and action buttons */
          <>
            {/* Template Form */}
            {task.template_id ? (
              loadingTaskTemplate === task.template_id ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-neutral-500">Loading form...</p>
                </div>
              ) : taskTemplates[task.template_id] ? (
                <DynamicCleaningForm
                  cleaningId={task.task_id}
                  propertyName={task.property_name}
                  template={taskTemplates[task.template_id]}
                  formMetadata={task.form_metadata}
                  onSave={async (formData) => {
                    await onSaveForm(task.task_id, formData);
                  }}
                />
              ) : (
                <p className="text-center text-neutral-500 py-8">
                  No template configured for this task
                </p>
              )
            ) : (
              <p className="text-center text-neutral-500 py-8">
                No template configured for this task
              </p>
            )}

            {/* Action Buttons */}
            <div className="pt-4 mt-4 border-t border-neutral-200 dark:border-neutral-700">
              <div className="flex flex-wrap gap-2">
                {task.status === 'in_progress' && (
                  <>
                    <Button
                      onClick={async () => {
                        await onUpdateStatus(task.task_id, 'paused');
                        setTask({ ...task, status: 'paused' });
                      }}
                      variant="outline"
                      className="flex-1"
                    >
                      Pause
                    </Button>
                    <Button
                      onClick={async () => {
                        await onUpdateStatus(task.task_id, 'complete');
                        setTask({ ...task, status: 'complete' });
                      }}
                      className="flex-1"
                    >
                      Complete
                    </Button>
                  </>
                )}
                {task.status === 'paused' && (
                  <>
                    <Button
                      onClick={async () => {
                        await onUpdateStatus(task.task_id, 'in_progress');
                        setTask({ ...task, status: 'in_progress' });
                      }}
                      className="flex-1"
                    >
                      Resume
                    </Button>
                    <Button
                      onClick={async () => {
                        await onUpdateStatus(task.task_id, 'complete');
                        setTask({ ...task, status: 'complete' });
                      }}
                      variant="outline"
                      className="flex-1"
                    >
                      Complete
                    </Button>
                  </>
                )}
                {(task.status === 'complete' || task.status === 'reopened') && (
                  <Button
                    onClick={async () => {
                      await onUpdateStatus(task.task_id, 'not_started');
                      setTask({ ...task, status: 'not_started' });
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    Reopen Task
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 p-4">
        <Button
          variant="outline"
          onClick={onClose}
          className="w-full"
        >
          Close Panel
        </Button>
      </div>
    </div>
  );
}
