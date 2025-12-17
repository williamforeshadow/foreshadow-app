'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldSeparator,
} from '@/components/ui/field';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';

interface CardDetailSheetProps {
  selectedCard: any;
  setSelectedCard: (card: any) => void;
  fullscreenTask: any;
  setFullscreenTask: (task: any) => void;
  showAddTaskDialog: boolean;
  setShowAddTaskDialog: (show: boolean) => void;
  showPropertyProjects: boolean;
  setShowPropertyProjects: (show: boolean) => void;
  taskTemplates: Record<string, any>;
  loadingTaskTemplate: string | null;
  availableTemplates: any[];
  addingTask: boolean;
  projects: any[];
  // Handler functions
  fetchTaskTemplate: (templateId: string) => Promise<void>;
  updateTaskAction: (taskId: string, action: string) => void;
  saveTaskForm: (taskId: string, formData: any) => Promise<void>;
  deleteTaskFromCard: (taskId: string) => void;
  addTaskToCard: (templateId: string) => void;
  fetchAvailableTemplates: () => void;
  openCreateProjectDialog: (propertyName: string) => void;
  setShowProjectsWindow: (show: boolean) => void;
  bringToFront: (windowId: string) => void;
}

const formatDate = (dateString: string) => {
  if (!dateString) return 'Not set';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function CardDetailSheet({
  selectedCard,
  setSelectedCard,
  fullscreenTask,
  setFullscreenTask,
  showAddTaskDialog,
  setShowAddTaskDialog,
  showPropertyProjects,
  setShowPropertyProjects,
  taskTemplates,
  loadingTaskTemplate,
  availableTemplates,
  addingTask,
  projects,
  fetchTaskTemplate,
  updateTaskAction,
  saveTaskForm,
  deleteTaskFromCard,
  addTaskToCard,
  fetchAvailableTemplates,
  openCreateProjectDialog,
  setShowProjectsWindow,
  bringToFront,
}: CardDetailSheetProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'border-l-red-500';
      case 'in_progress':
        return 'border-l-yellow-500';
      case 'complete':
        return 'border-l-emerald-500';
      default:
        return 'border-l-neutral-300';
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300';
      case 'in_progress':
        return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300';
      case 'paused':
        return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300';
      default:
        return 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300';
    }
  };

  const getTaskActionLabel = (action: string) => {
    switch (action) {
      case 'not_started': return 'Not Started';
      case 'in_progress': return 'In Progress';
      case 'paused': return 'Paused';
      case 'completed': return 'Completed';
      case 'reopened': return 'Reopened';
      default: return 'Not Started';
    }
  };

  // Task Template View (fullscreen task)
  const renderTaskView = () => (
    <>
      <SheetHeader className="border-b pb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFullscreenTask(null)}
            className="h-8 w-8 p-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
          <div className="flex-1">
            <SheetTitle className="text-xl">
              {fullscreenTask.template_name || 'Task'}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2 mt-1">
              <span>{selectedCard.property_name}</span>
              <Badge
                className={fullscreenTask.type === 'maintenance'
                  ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200'
                  : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                }
              >
                {fullscreenTask.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
              </Badge>
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <FieldSet>
          <FieldGroup>
            {/* Status & Assignment */}
            <Field orientation="horizontal">
              <FieldLabel className="min-w-[80px]">Status</FieldLabel>
              <FieldContent>
                <Badge className={getStatusBadgeClass(fullscreenTask.card_actions)}>
                  {getTaskActionLabel(fullscreenTask.card_actions)}
                </Badge>
              </FieldContent>
            </Field>

            <Field orientation="horizontal">
              <FieldLabel className="min-w-[80px]">Assigned</FieldLabel>
              <FieldContent>
                <span className="text-sm font-medium">
                  {fullscreenTask.assigned_staff || 'Unassigned'}
                </span>
              </FieldContent>
            </Field>
          </FieldGroup>

          <FieldSeparator>Task Form</FieldSeparator>

          {/* Template Form */}
          <div className="mt-2">
            {fullscreenTask.template_id ? (
              loadingTaskTemplate === fullscreenTask.template_id ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-muted-foreground">Loading form...</p>
                </div>
              ) : taskTemplates[fullscreenTask.template_id] ? (
                <DynamicCleaningForm
                  cleaningId={fullscreenTask.task_id}
                  propertyName={selectedCard?.property_name || ''}
                  template={taskTemplates[fullscreenTask.template_id]}
                  formMetadata={fullscreenTask.form_metadata}
                  onSave={async (formData) => {
                    await saveTaskForm(fullscreenTask.task_id, formData);
                  }}
                />
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No template configured for this task
                </p>
              )
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No template configured for this task
              </p>
            )}
          </div>
        </FieldSet>
      </div>

      <SheetFooter className="border-t p-4">
        <div className="flex flex-wrap gap-2 w-full">
          {(fullscreenTask.card_actions === 'not_started' || !fullscreenTask.card_actions) && (
            <>
              <Button
                onClick={() => {
                  updateTaskAction(fullscreenTask.task_id, 'in_progress');
                  setFullscreenTask({ ...fullscreenTask, card_actions: 'in_progress' });
                }}
                className="flex-1"
              >
                Start Task
              </Button>
              <Button
                onClick={() => {
                  updateTaskAction(fullscreenTask.task_id, 'completed');
                  setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                }}
                variant="outline"
                className="flex-1"
              >
                Mark Complete
              </Button>
            </>
          )}
          {fullscreenTask.card_actions === 'in_progress' && (
            <>
              <Button
                onClick={() => {
                  updateTaskAction(fullscreenTask.task_id, 'paused');
                  setFullscreenTask({ ...fullscreenTask, card_actions: 'paused' });
                }}
                variant="outline"
                className="flex-1"
              >
                Pause
              </Button>
              <Button
                onClick={() => {
                  updateTaskAction(fullscreenTask.task_id, 'completed');
                  setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                }}
                className="flex-1"
              >
                Complete
              </Button>
            </>
          )}
          {fullscreenTask.card_actions === 'paused' && (
            <>
              <Button
                onClick={() => {
                  updateTaskAction(fullscreenTask.task_id, 'in_progress');
                  setFullscreenTask({ ...fullscreenTask, card_actions: 'in_progress' });
                }}
                className="flex-1"
              >
                Resume
              </Button>
              <Button
                onClick={() => {
                  updateTaskAction(fullscreenTask.task_id, 'completed');
                  setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                }}
                variant="outline"
                className="flex-1"
              >
                Complete
              </Button>
            </>
          )}
          {(fullscreenTask.card_actions === 'completed' || fullscreenTask.card_actions === 'reopened') && (
            <Button
              onClick={() => {
                updateTaskAction(fullscreenTask.task_id, 'not_started');
                setFullscreenTask({ ...fullscreenTask, card_actions: 'not_started' });
              }}
              className="w-full"
            >
              Reopen Task
            </Button>
          )}
        </div>
      </SheetFooter>
    </>
  );

  // Main Card Detail View
  const renderCardView = () => (
    <>
      <SheetHeader className="border-b pb-4">
        <SheetTitle className="text-2xl">
          {selectedCard.title || selectedCard.property_name || 'Unknown'}
        </SheetTitle>
        <SheetDescription className="flex items-center gap-2 text-base">
          {selectedCard.guest_name ? (
            <>
              <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {selectedCard.guest_name}
            </>
          ) : (
            <span className="text-muted-foreground">
              {selectedCard.description || 'No description'}
            </span>
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <FieldSet>
          {/* Dates & Status Section */}
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel className="flex items-center gap-2 min-w-[120px]">
                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Check Out
              </FieldLabel>
              <FieldContent>
                <span className="text-sm font-medium">
                  {formatDate(selectedCard.check_out)}
                </span>
              </FieldContent>
            </Field>

            <Field orientation="horizontal">
              <FieldLabel className="flex items-center gap-2 min-w-[120px]">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Check In
              </FieldLabel>
              <FieldContent>
                <span className="text-sm font-medium">
                  {formatDate(selectedCard.next_check_in)}
                </span>
              </FieldContent>
            </Field>

            <Field orientation="horizontal">
              <FieldLabel className="flex items-center gap-2 min-w-[120px]">
                <svg className={`w-4 h-4 ${
                  selectedCard.occupancy_status === 'occupied' ? 'text-orange-500' : 'text-neutral-400'
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Occupancy
              </FieldLabel>
              <FieldContent>
                <Badge
                  variant={selectedCard.occupancy_status === 'occupied' ? 'default' : 'outline'}
                  className={
                    selectedCard.occupancy_status === 'occupied'
                      ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300'
                      : selectedCard.occupancy_status === 'general'
                      ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300'
                  }
                >
                  {selectedCard.occupancy_status === 'occupied' ? 'Occupied' :
                   selectedCard.occupancy_status === 'general' ? 'General' :
                   'Vacant'}
                </Badge>
              </FieldContent>
            </Field>
          </FieldGroup>

          <FieldSeparator>
            Tasks ({selectedCard.completed_tasks || 0}/{selectedCard.total_tasks || 0})
          </FieldSeparator>

          {/* Tasks Section */}
          {selectedCard.tasks && selectedCard.tasks.length > 0 ? (
            <div className="space-y-2">
              {selectedCard.tasks.map((task: any) => (
                <Card
                  key={task.task_id}
                  className={`cursor-pointer hover:shadow-md transition-all border-l-4 ${getStatusColor(task.card_actions === 'completed' ? 'complete' : task.card_actions === 'in_progress' ? 'in_progress' : 'not_started')}`}
                  onClick={async (e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    if (task.template_id && !taskTemplates[task.template_id]) {
                      await fetchTaskTemplate(task.template_id);
                    }
                    setFullscreenTask(task);
                  }}
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        {task.card_actions === 'completed' ? '✓' :
                         task.card_actions === 'in_progress' ? '▶' :
                         task.card_actions === 'paused' ? '⏸' : '○'}
                        {task.template_name || 'Unnamed Task'}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${task.type === 'maintenance'
                            ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200'
                            : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200'
                          }`}
                        >
                          {task.type === 'cleaning' ? 'Cleaning' : 'Maint.'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Remove this task from the turnover?')) {
                              deleteTaskFromCard(task.task_id);
                            }
                          }}
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-xs">
                      {getTaskActionLabel(task.card_actions)}
                      {task.assigned_staff && ` • ${task.assigned_staff}`}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}

              {/* Add Task Button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  fetchAvailableTemplates();
                  setShowAddTaskDialog(true);
                }}
              >
                + Add Task
              </Button>

              {/* Add Task Selector */}
              {showAddTaskDialog && (
                <div className="mt-2 p-3 border rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Select Template</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setShowAddTaskDialog(false)}
                    >
                      ✕
                    </Button>
                  </div>
                  {availableTemplates.length > 0 ? (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {availableTemplates
                        .filter(template =>
                          !selectedCard.tasks?.some((t: any) => t.template_id === template.id)
                        )
                        .map((template) => (
                          <Button
                            key={template.id}
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-8"
                            disabled={addingTask}
                            onClick={() => addTaskToCard(template.id)}
                          >
                            <Badge
                              variant="outline"
                              className={`mr-2 text-xs ${
                                template.type === 'maintenance'
                                  ? 'bg-orange-100 text-orange-800 border-orange-300'
                                  : 'bg-blue-100 text-blue-800 border-blue-300'
                              }`}
                            >
                              {template.type === 'cleaning' ? 'C' : 'M'}
                            </Badge>
                            <span className="text-sm">{template.name}</span>
                          </Button>
                        ))}
                      {availableTemplates.filter(t =>
                        !selectedCard.tasks?.some((task: any) => task.template_id === t.id)
                      ).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          All templates already assigned
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Loading templates...
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6 bg-muted/30 rounded-lg border border-dashed">
              <p className="text-sm text-muted-foreground mb-3">
                No tasks configured for this property.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  fetchAvailableTemplates();
                  setShowAddTaskDialog(true);
                }}
              >
                + Add Task
              </Button>

              {showAddTaskDialog && (
                <div className="mt-3 p-3 border rounded-lg bg-background text-left mx-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Select Template</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setShowAddTaskDialog(false)}
                    >
                      ✕
                    </Button>
                  </div>
                  {availableTemplates.length > 0 ? (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {availableTemplates.map((template) => (
                        <Button
                          key={template.id}
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start h-8"
                          disabled={addingTask}
                          onClick={() => addTaskToCard(template.id)}
                        >
                          <Badge
                            variant="outline"
                            className={`mr-2 text-xs ${
                              template.type === 'maintenance'
                                ? 'bg-orange-100 text-orange-800 border-orange-300'
                                : 'bg-blue-100 text-blue-800 border-blue-300'
                            }`}
                          >
                            {template.type === 'cleaning' ? 'C' : 'M'}
                          </Badge>
                          <span className="text-sm">{template.name}</span>
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Loading templates...
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Property Projects Section */}
          {selectedCard.property_name && (
            <>
              <FieldSeparator>
                Property Projects ({projects.filter(p => p.property_name === selectedCard.property_name).length})
              </FieldSeparator>

              <div className="rounded-lg border overflow-hidden">
                <button
                  onClick={() => setShowPropertyProjects(!showPropertyProjects)}
                  className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    <span className="text-sm font-medium">View Projects</span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showPropertyProjects ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showPropertyProjects && (
                  <div className="p-3 space-y-2 bg-background">
                    {projects.filter(p => p.property_name === selectedCard.property_name).length > 0 ? (
                      projects
                        .filter(p => p.property_name === selectedCard.property_name)
                        .map((project: any) => (
                          <div
                            key={project.id}
                            className="p-3 bg-muted/30 rounded-lg border"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm truncate">
                                  {project.title}
                                </h4>
                                {project.description && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    {project.description}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <Badge
                                  className={`text-xs ${
                                    project.status === 'complete'
                                      ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                                      : project.status === 'in_progress'
                                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                                      : project.status === 'on_hold'
                                      ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300'
                                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                                  }`}
                                >
                                  {project.status?.replace('_', ' ') || 'not started'}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span>{project.assigned_staff || 'Unassigned'}</span>
                              </div>
                              {project.due_date && (
                                <div className={`flex items-center gap-1 ${
                                  new Date(project.due_date) < new Date()
                                    ? 'text-red-500'
                                    : new Date(project.due_date) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                                    ? 'text-orange-500'
                                    : ''
                                }`}>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  <span>{new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                    ) : null}

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setShowProjectsWindow(true);
                        bringToFront('projects');
                        openCreateProjectDialog(selectedCard.property_name);
                      }}
                    >
                      + Create Project
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </FieldSet>
      </div>

      <SheetFooter className="border-t p-4">
        <Button
          variant="outline"
          onClick={() => setSelectedCard(null)}
          className="w-full"
        >
          Close
        </Button>
      </SheetFooter>
    </>
  );

  return (
    <Sheet
      open={!!selectedCard}
      onOpenChange={(open) => {
        if (!open) {
          setSelectedCard(null);
          setShowAddTaskDialog(false);
          setFullscreenTask(null);
          setShowPropertyProjects(false);
        }
      }}
    >
      <SheetContent
        side="right"
        className={`w-full sm:max-w-md flex flex-col p-0 border-l-4 ${
          selectedCard?.turnover_status === 'not_started' ? 'border-l-red-400' :
          selectedCard?.turnover_status === 'in_progress' ? 'border-l-yellow-400' :
          selectedCard?.turnover_status === 'complete' ? 'border-l-emerald-400' :
          'border-l-neutral-300'
        }`}
      >
        {selectedCard && (
          fullscreenTask ? renderTaskView() : renderCardView()
        )}
      </SheetContent>
    </Sheet>
  );
}
