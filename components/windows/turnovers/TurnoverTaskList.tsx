'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  onUpdateSchedule: (taskId: string, date: string) => void;
  onUpdateAssignment: (taskId: string, userIds: string[]) => void;
  onAddTask: (templateId: string) => void;
  onFetchTemplates: () => void;
  fetchTaskTemplate: (templateId: string) => Promise<void>;
}

function getStatusStyles(status: string) {
  switch (status) {
    case 'complete':
      return { border: 'border', badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
    case 'in_progress':
      return { border: 'border', badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800' };
    case 'paused':
      return { border: 'border', badge: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
    case 'contingent':
      return { border: 'border border-dashed border-neutral-300 dark:border-neutral-600', badge: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border-neutral-300 dark:border-neutral-600' };
    default:
      return { border: 'border', badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' };
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
    <div className="mt-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-neutral-900 dark:text-white">Select a Template</h4>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>✕</Button>
      </div>

      {templates.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {templates.map((template) => (
            <button
              key={template.id}
              className="w-full p-3 text-left border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              onClick={() => onSelect(template.id)}
            >
              <div className="font-medium text-sm">{template.name}</div>
              <div className="text-xs text-neutral-500 capitalize">{template.type}</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Loading templates...</p>
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

  const sortBySchedule = (a: Task, b: Task) => {
    if (!a.scheduled_start && !b.scheduled_start) return 0;
    if (!a.scheduled_start) return 1;
    if (!b.scheduled_start) return -1;
    return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
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

          return (
            <Card
              key={task.task_id}
              className={`cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 ${statusStyles.border}`}
              onClick={async () => {
                if (task.template_id && !taskTemplates[task.template_id]) {
                  await fetchTaskTemplate(task.template_id);
                }
                onTaskClick(task);
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{task.template_name || 'Unnamed Task'}</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Remove this task from the turnover?')) {
                        onDeleteTask(task.task_id);
                      }
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <Badge className={`px-2 py-0.5 text-xs border ${statusStyles.badge}`}>
                    {taskStatus === 'complete' ? 'Complete' :
                     taskStatus === 'in_progress' ? 'In Progress' :
                     taskStatus === 'paused' ? 'Paused' :
                     taskStatus === 'reopened' ? 'Reopened' :
                     taskStatus === 'contingent' ? 'Contingent' :
                     'Not Started'}
                  </Badge>
                  <Badge className={`px-2 py-0.5 text-xs border ${task.type === 'maintenance'
                    ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                    : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                  }`}>
                    {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                  </Badge>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-700">
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                          {task.scheduled_start ? new Date(task.scheduled_start).toLocaleDateString() : 'Date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                        <Calendar
                          mode="single"
                          selected={task.scheduled_start ? new Date(task.scheduled_start) : undefined}
                          onSelect={(date) => {
                            if (date) {
                              const existingDate = task.scheduled_start ? new Date(task.scheduled_start) : null;
                              if (existingDate) {
                                date.setHours(existingDate.getHours(), existingDate.getMinutes());
                              } else {
                                date.setHours(12, 0);
                              }
                              onUpdateSchedule(task.task_id, date.toISOString());
                            }
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <input
                      type="time"
                      className="h-7 px-2 text-xs border rounded-md bg-background dark:bg-neutral-800 dark:border-neutral-700"
                      value={task.scheduled_start ? new Date(task.scheduled_start).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        const [hours, minutes] = e.target.value.split(':').map(Number);
                        const date = task.scheduled_start ? new Date(task.scheduled_start) : new Date();
                        date.setHours(hours, minutes);
                        onUpdateSchedule(task.task_id, date.toISOString());
                      }}
                    />
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        {assignedUserIds.length > 0 ? (
                          <span className="flex items-center gap-1">
                            {(task.assigned_users || []).slice(0, 2).map((u) => (
                              <span key={u.user_id} title={u.name}>{u.avatar || '👤'}</span>
                            ))}
                            {assignedUserIds.length > 2 && <span className="text-neutral-500">+{assignedUserIds.length - 2}</span>}
                          </span>
                        ) : (
                          <span className="text-neutral-400">Assign</span>
                        )}
                      </Button>
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
                          <span className="mr-2">{user.avatar}</span>
                          {user.name}
                          <span className="ml-auto text-xs text-neutral-400">{user.role}</span>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
            </Card>
          );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Click a task to open
        </div>
      </div>

      {/* Approved Tasks */}
      <div className="flex flex-col gap-4">
        {approvedTasks.map((task) => renderTaskCard(task))}
      </div>

      {/* Contingent Tasks Section */}
      {contingentTasks.length > 0 && (
        <>
          <div className="border-t border-neutral-200 dark:border-neutral-700 pt-3">
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
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-3"
        onClick={handleAddTaskClick}
      >
        Add Task
      </Button>

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

