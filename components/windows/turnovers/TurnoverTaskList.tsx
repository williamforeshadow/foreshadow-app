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
      // Muted indigo — done, receding
      return {
        card: `${glassBase} bg-indigo-50/35 dark:bg-indigo-500/[0.06] border border-indigo-200/25 dark:border-indigo-400/10 text-muted-foreground/70`,
        badge: 'bg-indigo-500/10 text-indigo-400 dark:text-indigo-300/70 border-indigo-300/20 dark:border-indigo-500/15',
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
      // Rose gold — not started, needs attention
      return {
        card: `${glassBase} bg-rose-50/55 dark:bg-rose-400/[0.10] border border-rose-200/40 dark:border-rose-400/18`,
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-300/35 dark:border-rose-500/20',
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

  const sortBySchedule = (a: Task, b: Task) => {
    if (!a.scheduled_date && !b.scheduled_date) return 0;
    if (!a.scheduled_date) return 1;
    if (!b.scheduled_date) return -1;
    const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
    if (dateCompare !== 0) return dateCompare;
    // Same date — compare by time
    if (!a.scheduled_time && !b.scheduled_time) return 0;
    if (!a.scheduled_time) return 1;
    if (!b.scheduled_time) return -1;
    return a.scheduled_time.localeCompare(b.scheduled_time);
  };

  const approvedTasks = tasks.filter(t => t.status !== 'contingent').sort(sortBySchedule);
  const contingentTasks = tasks.filter(t => t.status === 'contingent').sort(sortBySchedule);

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
        className={`cursor-pointer hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 ease-out p-4 ${statusStyles.card}`}
        onClick={async () => {
          const propName = selectedCard.property_name;
          const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
          if (task.template_id && !taskTemplates[cacheKey!]) {
            await fetchTaskTemplate(task.template_id, propName);
          }
          onTaskClick(task);
        }}
      >
        {/* Top row: icon + name + delete */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <DeptIcon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
            <span className="text-sm font-medium truncate">{task.template_name || 'Unnamed Task'}</span>
          </div>
          <button
            className="h-6 w-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-red-500 hover:bg-white/30 dark:hover:bg-white/10 transition-colors shrink-0"
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

        {/* Bottom row: date/time + assigned users */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button className="h-7 px-2.5 text-xs rounded-lg border border-white/20 dark:border-white/15 bg-white/25 dark:bg-white/[0.08] backdrop-blur-sm hover:bg-white/40 dark:hover:bg-white/12 transition-colors">
                  {task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00').toLocaleDateString() : 'Date'}
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
            <input
              type="time"
              className="h-7 px-2 text-xs rounded-lg border border-white/20 dark:border-white/15 bg-white/25 dark:bg-white/[0.08] backdrop-blur-sm"
              value={task.scheduled_time ? task.scheduled_time.slice(0, 5) : ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                const newTime = e.target.value || null;
                onUpdateSchedule(task.task_id, task.scheduled_date || null, newTime);
              }}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="flex items-center gap-1 text-xs hover:opacity-80 transition-opacity">
                {assignedUserIds.length > 0 ? (
                  <>
                    <span className="flex items-center -space-x-1.5">
                      {(task.assigned_users || []).slice(0, 3).map((u) => (
                        u.avatar ? (
                          <img key={u.user_id} src={u.avatar} alt={u.name} title={u.name} className="h-6 w-6 rounded-full object-cover ring-2 ring-white/50 dark:ring-white/10" />
                        ) : (
                          <span key={u.user_id} title={u.name} className="h-6 w-6 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[10px] ring-2 ring-white/50 dark:ring-white/10">👤</span>
                        )
                      ))}
                    </span>
                    {assignedUserIds.length > 3 && <span className="text-neutral-500 dark:text-neutral-400 ml-1">+{assignedUserIds.length - 3}</span>}
                  </>
                ) : (
                  <span className="text-neutral-400 dark:text-neutral-500 text-xs">Assign</span>
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

