'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { KeyAffordance } from '@/components/tasks/KeyAffordance';
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
import type { Task, Turnover, User } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';

interface TaskTemplateBasic {
  id: string;
  name: string;
  type: string;
}

interface TurnoverTaskListProps {
  selectedCard: Turnover;
  users: User[];
  taskTemplates: Record<string, Template>;
  availableTemplates: TaskTemplateBasic[];
  showAddTaskDialog: boolean;
  setShowAddTaskDialog: (show: boolean) => void;
  onTaskClick: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateSchedule: (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => void;
  onUpdateAssignment: (taskId: string, userIds: string[]) => void;
  onAddTask: (templateId: string) => void;
  onFetchTemplates: () => void;
  fetchTaskTemplate: (templateId: string, propertyName?: string) => Promise<void>;
}

function getStatusStyles(status: string) {
  // Glass card base + status-specific tint (matches turnover card color scheme)
  const glassBase = 'glass-card glass-sheen relative overflow-hidden rounded-xl';
  switch (status) {
    case 'complete':
      // Emerald green — done, completed
      return {
        card: `${glassBase} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`,
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/35 dark:border-emerald-500/25',
      };
    case 'in_progress':
      // Indigo — actively being worked on
      return {
        card: `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`,
        badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300/35 dark:border-indigo-500/25',
      };
    case 'paused':
      // Treat paused same as in_progress (midnight blue)
      return {
        card: `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`,
        badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300/35 dark:border-indigo-500/25',
      };
    case 'contingent':
      // Neutral dashed — contingent
      return {
        card: `${glassBase} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`,
        badge: 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400 border-neutral-300/25 dark:border-white/10',
      };
    default:
      // Rose gold — warm peachy-gold, not started, needs attention
      return {
        card: `${glassBase} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`,
        badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/35 dark:border-amber-500/20',
      };
  }
}

function AddTaskDialog({
  templates,
  onSelect,
  onClose,
}: {
  templates: TaskTemplateBasic[];
  onSelect: (templateId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 p-4 rounded-xl glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10 bg-white/40 dark:bg-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium">Select a Template</h4>
        <button className="h-6 w-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-white/30 dark:hover:bg-white/10 transition-colors" onClick={onClose}>✕</button>
      </div>

      {templates.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {templates.map((template) => (
            <button
              key={template.id}
              className="w-full p-3 text-left rounded-lg border border-white/20 dark:border-white/10 bg-white/25 dark:bg-white/[0.05] hover:bg-white/40 dark:hover:bg-white/10 backdrop-blur-sm transition-colors"
              onClick={() => onSelect(template.id)}
            >
              <div className="font-medium text-sm">{template.name}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 capitalize">{template.type}</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading templates...</p>
      )}
    </div>
  );
}

export function TurnoverTaskList({
  selectedCard,
  users,
  taskTemplates,
  availableTemplates,
  showAddTaskDialog,
  setShowAddTaskDialog,
  onTaskClick,
  onDeleteTask,
  onUpdateSchedule,
  onUpdateAssignment,
  onAddTask,
  onFetchTemplates,
  fetchTaskTemplate,
}: TurnoverTaskListProps) {
  const tasks = selectedCard.tasks || [];
  const [showContingent, setShowContingent] = useState(false);
  const { deptIconMap } = useDepartments();

  // ── Snapshot-based sort order ──────────────────────────────────
  // We capture the task order once when the card opens (or when the
  // card id changes). Schedule edits update the DB and the displayed
  // values, but the *visual order* only refreshes when the user
  // clicks out and back in (i.e. selectedCard.id changes).
  const sortBySchedule = (a: Task, b: Task) => {
    if (!a.scheduled_date && !b.scheduled_date) return 0;
    if (!a.scheduled_date) return 1;
    if (!b.scheduled_date) return -1;
    const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
    if (dateCompare !== 0) return dateCompare;
    if (!a.scheduled_time && !b.scheduled_time) return 0;
    if (!a.scheduled_time) return 1;
    if (!b.scheduled_time) return -1;
    return a.scheduled_time.localeCompare(b.scheduled_time);
  };

  // Snapshot the sort order when the card first opens
  const [sortOrderIds, setSortOrderIds] = useState<string[]>([]);
  const lastCardId = useRef<string | null>(null);

  useEffect(() => {
    if (selectedCard.id !== lastCardId.current) {
      lastCardId.current = selectedCard.id;
      const approved = tasks.filter(t => t.status !== 'contingent').sort(sortBySchedule);
      const contingent = tasks.filter(t => t.status === 'contingent').sort(sortBySchedule);
      setSortOrderIds([...approved.map(t => t.task_id), ...contingent.map(t => t.task_id)]);
    }
  }, [selectedCard.id, tasks]);

  // Sort using the snapshot order; any new tasks go to the end
  const stableSort = (taskList: Task[]) => {
    return [...taskList].sort((a, b) => {
      const ai = sortOrderIds.indexOf(a.task_id);
      const bi = sortOrderIds.indexOf(b.task_id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  };

  const approvedTasks = stableSort(tasks.filter(t => t.status !== 'contingent'));
  const contingentTasks = stableSort(tasks.filter(t => t.status === 'contingent'));

  const handleAddTaskClick = () => {
    onFetchTemplates();
    setShowAddTaskDialog(true);
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <p>No tasks assigned yet</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={handleAddTaskClick}
        >
          Add Task
        </Button>

        {showAddTaskDialog && (
          <AddTaskDialog
            templates={availableTemplates}
            onSelect={onAddTask}
            onClose={() => setShowAddTaskDialog(false)}
          />
        )}
      </div>
    );
  }

  const renderTaskCard = (task: Task) => {
    const assignedUserIds = (task.assigned_users || []).map((u) => u.user_id);
    const taskStatus = task.status || 'not_started';
    const statusStyles = getStatusStyles(taskStatus);
    const DeptIcon = getDepartmentIcon(task.department_id ? deptIconMap[task.department_id] : null);

    return (
      <div
        key={task.task_id}
        className={`group cursor-pointer hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] has-[[data-state=open]]:scale-100 has-[[data-state=open]]:shadow-none transition-all duration-200 ease-out p-3.5 ${statusStyles.card}`}
        onClick={async () => {
          const propName = selectedCard.property_name;
          const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
          if (task.template_id && !taskTemplates[cacheKey!]) {
            await fetchTaskTemplate(task.template_id, propName);
          }
          onTaskClick(task);
        }}
      >
        <div className="flex items-center gap-3">
          {/* Left: icon badge */}
          <div className="w-9 h-9 rounded-lg bg-black/10 dark:bg-black/40 flex items-center justify-center shrink-0 self-center">
            <DeptIcon className="w-4.5 h-4.5 text-neutral-600 dark:text-neutral-300" />
          </div>

          {/* Middle: title + date/time stacked */}
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium truncate min-w-0">{task.template_name || 'Unnamed Task'}</span>
              {/* Every row here is reservation-bound by construction. The
                  TurnoversWindow wraps this panel in <ReservationContextOverride>
                  so KeyAffordance sees `currentReservationId === task.reservation_id`
                  and renders its static (no-op) variant — clicking the same key
                  the user just opened the panel from would be confusing. */}
              <KeyAffordance
                reservationId={task.reservation_id ?? selectedCard?.id ?? null}
                size={12}
                iconClassName="text-neutral-400 dark:text-neutral-500"
              />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 px-2 py-1 rounded-lg bg-black/10 dark:bg-black/40 w-fit">
              <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <Popover modal>
                <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button className="hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                    {task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Date'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                  <Calendar
                    mode="single"
                    selected={task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00') : undefined}
                    onSelect={(date) => {
                      if (date) {
                        const y = date.getFullYear();
                        const m = String(date.getMonth() + 1).padStart(2, '0');
                        const d = String(date.getDate()).padStart(2, '0');
                        const newDate = `${y}-${m}-${d}`;
                        onUpdateSchedule(task.task_id, newDate, task.scheduled_time || null);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-neutral-400 dark:text-neutral-600">·</span>
              <Popover modal>
                <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button className="hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                    {task.scheduled_time ? (() => {
                      const [h, m] = task.scheduled_time!.slice(0, 5).split(':').map(Number);
                      const ampm = h >= 12 ? 'PM' : 'AM';
                      const h12 = h % 12 || 12;
                      return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
                    })() : 'Time'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="time"
                    className="bg-transparent text-sm cursor-pointer"
                    value={task.scheduled_time ? task.scheduled_time.slice(0, 5) : ''}
                    autoFocus
                    onChange={(e) => {
                      e.stopPropagation();
                      const newTime = e.target.value || null;
                      onUpdateSchedule(task.task_id, task.scheduled_date || null, newTime);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Right: avatar(s), vertically centered */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="flex items-center shrink-0 hover:opacity-80 transition-opacity self-center">
                {assignedUserIds.length > 0 ? (
                  <span className="flex items-center -space-x-2">
                    {(task.assigned_users || []).slice(0, 3).map((u) => (
                      u.avatar ? (
                        <img key={u.user_id} src={u.avatar} alt={u.name} title={u.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white/50 dark:ring-white/10" />
                      ) : (
                        <span key={u.user_id} title={u.name} className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs ring-2 ring-white/50 dark:ring-white/10">👤</span>
                      )
                    ))}
                    {assignedUserIds.length > 3 && <span className="text-neutral-500 dark:text-neutral-400 ml-1 text-xs">+{assignedUserIds.length - 3}</span>}
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
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>Assign Users</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {users.map((user) => (
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
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Delete — visible on hover */}
          <button
            className="h-6 w-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-red-500 hover:bg-white/30 dark:hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100 shrink-0 self-center"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Remove this task from the turnover?')) {
                onDeleteTask(task.task_id);
              }
            }}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Approved Tasks */}
      <div className="flex flex-col gap-4">
        {approvedTasks.map((task) => renderTaskCard(task))}
      </div>

      {/* Contingent Tasks Section */}
      {contingentTasks.length > 0 && (
        <>
          <div className="border-t border-white/20 dark:border-white/10 !mt-6 pt-4">
            <button
              onClick={() => setShowContingent(!showContingent)}
              className="w-full text-left text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center gap-2"
            >
              <svg className={`h-4 w-4 transition-transform ${showContingent ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Show {contingentTasks.length} contingent task{contingentTasks.length !== 1 ? 's' : ''}
            </button>
          </div>

          {showContingent && (
            <div className="flex flex-col gap-4">
              {contingentTasks.map((task) => renderTaskCard(task))}
            </div>
          )}
        </>
      )}

      {/* Add Task Button */}
      <button
        className="w-full mt-3 h-9 px-4 text-sm rounded-xl border border-dashed border-neutral-400/50 dark:border-white/15 bg-white/25 dark:bg-white/[0.05] backdrop-blur-sm text-neutral-500 dark:text-neutral-400 hover:bg-white/40 dark:hover:bg-white/10 hover:border-neutral-400/70 dark:hover:border-white/25 transition-all"
        onClick={handleAddTaskClick}
      >
        + Add Task
      </button>

      {/* Add Task Panel */}
      {showAddTaskDialog && (
        <AddTaskDialog
          templates={availableTemplates}
          onSelect={onAddTask}
          onClose={() => setShowAddTaskDialog(false)}
        />
      )}
    </div>
  );
}

