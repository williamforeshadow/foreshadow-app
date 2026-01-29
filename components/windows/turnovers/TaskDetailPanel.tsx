'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import type { Task, User } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

interface TaskDetailPanelProps {
  task: Task;
  propertyName: string;
  currentUser: User | null;
  taskTemplates: Record<string, Template>;
  loadingTaskTemplate: string | null;
  onClose: () => void;
  onUpdateStatus: (taskId: string, status: string) => void;
  onSaveForm: (taskId: string, formData: Record<string, unknown>) => Promise<void>;
  setTask: (task: Task) => void;
  onShowTurnover?: () => void;
}

export function TaskDetailPanel({
  task,
  propertyName,
  currentUser,
  taskTemplates,
  loadingTaskTemplate,
  onClose,
  onUpdateStatus,
  onSaveForm,
  setTask,
  onShowTurnover,
}: TaskDetailPanelProps) {
  const isAssigned = (task.assigned_users || []).some((u) => u.user_id === currentUser?.id);
  const isNotStarted = task.status === 'not_started' || !task.status;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{task.template_name || 'Task'}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-neutral-500">{propertyName}</span>
              <Badge
                className={task.type === 'maintenance'
                  ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200'
                  : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                }
              >
                {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
              </Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 space-y-4 overflow-auto overscroll-contain">
        {/* Task Status Bar */}
        <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-between">
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Status</p>
            <Badge
              className={`${
                task.status === 'complete'
                  ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                  : task.status === 'in_progress'
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  : task.status === 'paused'
                  ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                  : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
              }`}
            >
              {task.status === 'not_started' ? 'Not Started' :
               task.status === 'in_progress' ? 'In Progress' :
               task.status === 'paused' ? 'Paused' :
               task.status === 'complete' ? 'Completed' :
               task.status === 'reopened' ? 'Reopened' :
               'Not Started'}
            </Badge>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Assigned to</p>
            <p className="text-sm font-medium text-neutral-900 dark:text-white">
              {task.assigned_staff || 'Unassigned'}
            </p>
          </div>
        </div>

        {/* TASK VIEW - Check assignment first, then status */}
        {!isAssigned ? (
          /* NOT ASSIGNED - Block access to task */
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Button disabled variant="outline">
              Start Task
            </Button>
            <p className="text-sm text-neutral-500">This task hasn&apos;t been assigned</p>
          </div>
        ) : isNotStarted ? (
          /* ASSIGNED + NOT STARTED - Show Start button */
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Button
              onClick={() => {
                onUpdateStatus(task.task_id, 'in_progress');
                setTask({ ...task, status: 'in_progress' });
              }}
            >
              Start Task
            </Button>
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
                  propertyName={propertyName}
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

            {/* Action Buttons - Only show for active tasks */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <div className="flex flex-wrap gap-2">
                {task.status === 'in_progress' && (
                  <>
                    <Button
                      onClick={() => {
                        onUpdateStatus(task.task_id, 'paused');
                        setTask({ ...task, status: 'paused' });
                      }}
                      variant="outline"
                      className="flex-1"
                    >
                      Pause
                    </Button>
                    <Button
                      onClick={() => {
                        onUpdateStatus(task.task_id, 'complete');
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
                      onClick={() => {
                        onUpdateStatus(task.task_id, 'in_progress');
                        setTask({ ...task, status: 'in_progress' });
                      }}
                      className="flex-1"
                    >
                      Resume
                    </Button>
                    <Button
                      onClick={() => {
                        onUpdateStatus(task.task_id, 'complete');
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
                    onClick={() => {
                      onUpdateStatus(task.task_id, 'not_started');
                      setTask({ ...task, status: 'not_started' });
                    }}
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
      {onShowTurnover && (
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-4">
          <Button
            variant="outline"
            onClick={onShowTurnover}
            className="w-full"
          >
            Active Turnover
          </Button>
        </div>
      )}
    </div>
  );
}

