'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import type { Task, User } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';

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
  users?: User[];
  onUpdateSchedule?: (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => void;
  onUpdateAssignment?: (taskId: string, userIds: string[]) => void;
}

function getStatusStyles(status: string) {
  const glassBase = 'glass-card glass-sheen relative overflow-hidden rounded-xl';
  switch (status) {
    case 'complete':
      return {
        card: `${glassBase} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`,
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/35 dark:border-emerald-500/25',
      };
    case 'in_progress':
      return {
        card: `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`,
        badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300/35 dark:border-indigo-500/25',
      };
    case 'paused':
      return {
        card: `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`,
        badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300/35 dark:border-indigo-500/25',
      };
    case 'contingent':
      return {
        card: `${glassBase} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`,
        badge: 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400 border-neutral-300/25 dark:border-white/10',
      };
    default:
      return {
        card: `${glassBase} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`,
        badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/35 dark:border-amber-500/20',
      };
  }
}

function formatTime12(time: string) {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
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
  users,
  onUpdateSchedule,
  onUpdateAssignment,
}: TaskDetailPanelProps) {
  const isAssigned = (task.assigned_users || []).some((u) => u.user_id === currentUser?.id);
  const isContingent = task.status === 'contingent';
  const isNotStarted = task.status === 'not_started' || !task.status;
  const isActive = !isContingent && !isNotStarted;
  const { deptIconMap } = useDepartments();
  const DeptIcon = getDepartmentIcon(task.department_id ? deptIconMap[task.department_id] : null);
  const styles = getStatusStyles(task.status || 'not_started');
  const assignedUsers = task.assigned_users || [];
  const [requiredFieldsFilled, setRequiredFieldsFilled] = useState(false);

  const resolvedTemplate = task.template_id
    ? (taskTemplates[`${task.template_id}__${propertyName}`] || taskTemplates[task.template_id])
    : undefined;

  // Tiny pill button style for inline action buttons
  const tinyBtn = 'h-6 text-[11px] px-2.5 rounded-md font-medium';

  // Action buttons based on current state
  const renderActionButtons = () => {
    if (isContingent) {
      return (
        <Button
          size="sm"
          className={tinyBtn}
          onClick={() => {
            onUpdateStatus(task.task_id, 'not_started');
            setTask({ ...task, status: 'not_started' });
          }}
        >
          Approve
        </Button>
      );
    }
    if (!isAssigned) return null;
    if (isNotStarted) {
      return (
        <Button
          size="sm"
          className={tinyBtn}
          onClick={() => {
            onUpdateStatus(task.task_id, 'in_progress');
            setTask({ ...task, status: 'in_progress' });
          }}
        >
          Start Task
        </Button>
      );
    }
    if (task.status === 'in_progress') {
      return (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className={tinyBtn}
            onClick={() => {
              onUpdateStatus(task.task_id, 'paused');
              setTask({ ...task, status: 'paused' });
            }}
          >
            Pause
          </Button>
          <Button
            size="sm"
            className={tinyBtn}
            disabled={!requiredFieldsFilled}
            onClick={() => {
              onUpdateStatus(task.task_id, 'complete');
              setTask({ ...task, status: 'complete' });
            }}
          >
            Complete
          </Button>
        </div>
      );
    }
    if (task.status === 'paused') {
      return (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className={tinyBtn}
            onClick={() => {
              onUpdateStatus(task.task_id, 'in_progress');
              setTask({ ...task, status: 'in_progress' });
            }}
          >
            Resume
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={tinyBtn}
            disabled={!requiredFieldsFilled}
            onClick={() => {
              onUpdateStatus(task.task_id, 'complete');
              setTask({ ...task, status: 'complete' });
            }}
          >
            Complete
          </Button>
        </div>
      );
    }
    if (task.status === 'complete') {
      return (
        <Button
          size="sm"
          variant="outline"
          className={tinyBtn}
          onClick={() => {
            onUpdateStatus(task.task_id, 'paused');
            setTask({ ...task, status: 'paused' });
          }}
        >
          Reopen
        </Button>
      );
    }
    return null;
  };

  const actionButtons = renderActionButtons();

  return (
    <div className="flex flex-col h-full">
      {/* ── Unified Header ── */}
      <div className="sticky top-0 z-10 p-4 space-y-3 backdrop-blur-xl">
        {/* Back row */}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Glass card — mirrors task card from TurnoverTaskList */}
        <div className={`p-3 ${styles.card}`}>
          <div className="flex items-center gap-3">
            {/* Department icon */}
            <div className="w-9 h-9 rounded-lg bg-black/10 dark:bg-black/40 flex items-center justify-center shrink-0">
              <DeptIcon className="w-4.5 h-4.5 text-neutral-600 dark:text-neutral-300" />
            </div>

            {/* Middle: title, property, date+action row */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {/* Title + property grouped */}
              <div className="flex flex-col gap-0.5">
                {/* Task name */}
                <span className="text-sm font-medium truncate">
                  {task.template_name || 'Task'}
                </span>

                {/* Property name */}
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {propertyName}
                </div>
              </div>

              {/* Date/time + action button — same row */}
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 px-2 py-1 rounded-lg bg-black/10 dark:bg-black/40">
                  <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {onUpdateSchedule ? (
                    <>
                      <Popover modal>
                        <PopoverTrigger asChild>
                          <button className="hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                            {task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Date'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00') : undefined}
                            onSelect={(date) => {
                              if (date) {
                                const y = date.getFullYear();
                                const m = String(date.getMonth() + 1).padStart(2, '0');
                                const d = String(date.getDate()).padStart(2, '0');
                                onUpdateSchedule(task.task_id, `${y}-${m}-${d}`, task.scheduled_time || null);
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                      <span className="text-neutral-400 dark:text-neutral-600">·</span>
                      <Popover modal>
                        <PopoverTrigger asChild>
                          <button className="hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                            {task.scheduled_time ? formatTime12(task.scheduled_time) : 'Time'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                          <input
                            type="time"
                            className="bg-transparent text-sm cursor-pointer"
                            value={task.scheduled_time ? task.scheduled_time.slice(0, 5) : ''}
                            autoFocus
                            onChange={(e) => {
                              const newTime = e.target.value || null;
                              onUpdateSchedule(task.task_id, task.scheduled_date || null, newTime);
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </>
                  ) : (
                    <>
                      {task.scheduled_date && (
                        <span>
                          {new Date(task.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {task.scheduled_date && task.scheduled_time && (
                        <span className="text-neutral-400 dark:text-neutral-600">·</span>
                      )}
                      {task.scheduled_time && (
                        <span>{formatTime12(task.scheduled_time)}</span>
                      )}
                    </>
                  )}
                </div>
                {actionButtons}
              </div>
            </div>

            {/* Assigned user avatars */}
            {onUpdateAssignment && users ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center shrink-0 hover:opacity-80 transition-opacity self-center">
                    {assignedUsers.length > 0 ? (
                      <span className="flex items-center -space-x-2">
                        {assignedUsers.slice(0, 3).map((u) =>
                          u.avatar ? (
                            <img key={u.user_id} src={u.avatar} alt={u.name} title={u.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white/50 dark:ring-white/10" />
                          ) : (
                            <span key={u.user_id} title={u.name} className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs ring-2 ring-white/50 dark:ring-white/10">👤</span>
                          )
                        )}
                        {assignedUsers.length > 3 && <span className="text-neutral-500 dark:text-neutral-400 ml-1.5 text-xs">+{assignedUsers.length - 3}</span>}
                      </span>
                    ) : (
                      <span className="h-9 w-9 rounded-full border-2 border-dashed border-neutral-400/50 dark:border-white/20 flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:border-neutral-500 dark:hover:border-white/30 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Assign Users</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {users.map((user) => {
                    const assignedUserIds = assignedUsers.map((u) => u.user_id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={user.id}
                        checked={assignedUserIds.includes(user.id)}
                        onCheckedChange={(checked) => {
                          const newIds = checked
                            ? [...assignedUserIds, user.id]
                            : assignedUserIds.filter((id) => id !== user.id);
                          onUpdateAssignment(task.task_id, newIds);
                        }}
                      >
                        {user.avatar ? (
                          <img src={user.avatar} alt={user.name} className="mr-2 h-5 w-5 rounded-full object-cover" />
                        ) : (
                          <span className="mr-2">👤</span>
                        )}
                        {user.name}
                        <span className="ml-auto text-xs text-neutral-400">{user.role}</span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="shrink-0">
                {assignedUsers.length > 0 ? (
                  <div className="flex items-center -space-x-2">
                    {assignedUsers.slice(0, 3).map((u) =>
                      u.avatar ? (
                        <img key={u.user_id} src={u.avatar} alt={u.name} title={u.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white/50 dark:ring-white/10" />
                      ) : (
                        <span key={u.user_id} title={u.name} className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-medium ring-2 ring-white/50 dark:ring-white/10">
                          {u.name?.charAt(0)?.toUpperCase() || '?'}
                        </span>
                      )
                    )}
                    {assignedUsers.length > 3 && (
                      <span className="text-neutral-500 dark:text-neutral-400 ml-1.5 text-xs">+{assignedUsers.length - 3}</span>
                    )}
                  </div>
                ) : (
                  <span className="h-9 w-9 rounded-full border-2 border-dashed border-neutral-400/50 dark:border-white/20 flex items-center justify-center text-neutral-400 dark:text-neutral-500">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Content — form (read-only preview when not started, interactive when active) ── */}
      <div className="flex-1 p-6 overflow-auto overscroll-contain">
        {task.template_id ? (
          loadingTaskTemplate === task.template_id ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-neutral-500">Loading form...</p>
            </div>
          ) : resolvedTemplate ? (
            <DynamicCleaningForm
              cleaningId={task.task_id}
              propertyName={propertyName}
              template={resolvedTemplate}
              formMetadata={task.form_metadata}
              onSave={async (formData) => {
                await onSaveForm(task.task_id, formData);
              }}
              readOnly={!isActive || !isAssigned}
              onValidationChange={setRequiredFieldsFilled}
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
      </div>

      {/* ── Footer ── */}
      {onShowTurnover && (
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-4">
          <Button variant="outline" onClick={onShowTurnover} className="w-full">
            Associated Turnover
          </Button>
        </div>
      )}
    </div>
  );
}
