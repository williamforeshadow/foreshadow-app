'use client';

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip/tooltip';
import DiamondIcon from '@/components/icons/AssignmentIcon';
import HexagonIcon from '@/components/icons/HammerIcon';
import TurnoverCards from '@/components/TurnoverCards';
import { useTurnovers } from '@/lib/useTurnovers';
import type { useProjects } from '@/lib/useProjects';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import {
  TurnoverFilterBar,
  TurnoverTaskList,
  TurnoverProjectsPanel,
} from './turnovers';
import { ProjectDetailPanel, AttachmentLightbox, ProjectActivitySheet } from './projects';
import type { Template } from '@/components/DynamicCleaningForm';
import type { User, Task, Turnover, Project, ProjectFormFields } from '@/lib/types';

interface TurnoversWindowProps {
  users: User[];
  currentUser: User | null;
  projectsHook: ReturnType<typeof useProjects>;
  onOpenProjectInWindow: (project: any) => void;
}

function TurnoversWindowContent({
  users,
  currentUser,
  projectsHook,
  onOpenProjectInWindow,
}: TurnoversWindowProps) {
  // Turnover/task functionality
  const {
    // Core data
    response,
    error,
    loading,

    // View state
    viewMode,
    setViewMode,
    filters,
    sortBy,

    // Filter functions
    toggleFilter,
    clearAllFilters,
    getActiveFilterCount,

    // Selection
    selectedCard,
    setSelectedCard,
    closeSelectedCard,
    fullscreenTask,
    setFullscreenTask,
    rightPanelView,
    setRightPanelView,

    // Task state
    taskTemplates,
    loadingTaskTemplate,
    availableTemplates,
    showAddTaskDialog,
    setShowAddTaskDialog,

    // Task actions
    updateTaskAction,
    updateTaskAssignment,
    updateTaskSchedule,
    fetchTaskTemplate,
    saveTaskForm,
    fetchAvailableTemplates,
    addTaskToCard,
    deleteTaskFromCard,

    // Refs
    rightPanelRef,
    scrollPositionRef,
  } = useTurnovers();

  // ============================================================================
  // LOCAL instances of sub-hooks (independent from ProjectsWindow)
  // ============================================================================
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const activityHook = useProjectActivity();

  // ============================================================================
  // LOCAL UI State for Projects Panel (independent from other windows)
  // ============================================================================
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [projectFields, setProjectFields] = useState<ProjectFormFields | null>(null);
  const [newComment, setNewComment] = useState('');
  const [staffOpen, setStaffOpen] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);

  // Ref to track the latest project fields (avoids stale closure issues)
  const projectFieldsRef = useRef<ProjectFormFields | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    projectFieldsRef.current = projectFields;
  }, [projectFields]);

  // ============================================================================
  // Task → ProjectDetailPanel state (unified task detail view)
  // ============================================================================
  const [taskEditingFields, setTaskEditingFields] = useState<ProjectFormFields | null>(null);
  const [taskStaffOpen, setTaskStaffOpen] = useState(false);
  const taskEditingFieldsRef = useRef<ProjectFormFields | null>(null);
  const taskAttachmentRef = useRef<HTMLInputElement>(null);
  const [taskNewComment, setTaskNewComment] = useState('');
  const [taskViewingAttachmentIndex, setTaskViewingAttachmentIndex] = useState<number | null>(null);

  const taskCommentsHook = useProjectComments({ currentUser });
  const taskAttachmentsHook = useProjectAttachments({ currentUser });
  const taskTimeTrackingHook = useProjectTimeTracking({ currentUser });
  const binsHook = useProjectBins({ currentUser });

  useEffect(() => {
    taskEditingFieldsRef.current = taskEditingFields;
  }, [taskEditingFields]);

  // Initialize task editing fields + fetch data when a task is opened
  useEffect(() => {
    if (fullscreenTask) {
      setTaskEditingFields({
        title: fullscreenTask.title || fullscreenTask.template_name || 'Task',
        description: fullscreenTask.description || null,
        status: fullscreenTask.status,
        priority: fullscreenTask.priority || 'medium',
        assigned_staff: (fullscreenTask.assigned_users || []).map(u => u.user_id),
        department_id: fullscreenTask.department_id || '',
        scheduled_date: fullscreenTask.scheduled_date || '',
        scheduled_time: fullscreenTask.scheduled_time || '',
      });
      if (fullscreenTask.template_id && selectedCard?.property_name) {
        fetchTaskTemplate(fullscreenTask.template_id, selectedCard.property_name);
      }
      taskCommentsHook.fetchProjectComments(fullscreenTask.task_id, 'task');
      taskAttachmentsHook.fetchProjectAttachments(fullscreenTask.task_id, 'task');
      taskTimeTrackingHook.fetchProjectTimeEntries(fullscreenTask.task_id, 'task');
    } else {
      setTaskEditingFields(null);
      setTaskStaffOpen(false);
      setTaskNewComment('');
      taskCommentsHook.clearComments();
      taskAttachmentsHook.clearAttachments();
      taskTimeTrackingHook.clearTimeTracking();
    }
  }, [fullscreenTask?.task_id]);

  // ============================================================================
  // Reset project state when switching to a different turnover card
  // ============================================================================
  useEffect(() => {
    setExpandedProject(null);
    setProjectFields(null);
    setRightPanelView('tasks');
  }, [selectedCard?.id]);

  // ============================================================================
  // SHARED data from projectsHook (only core project data and mutations)
  // ============================================================================
  const {
    projects,
    savingProjectEdit,
    saveProjectById,
    deleteProject,
  } = projectsHook;

  // ============================================================================
  // Initialize project fields when expanding a project
  // ============================================================================
  useEffect(() => {
    if (expandedProject) {
      setProjectFields({
        title: expandedProject.title,
        description: expandedProject.description || null,
        status: expandedProject.status,
        priority: expandedProject.priority,
        assigned_staff: expandedProject.project_assignments?.map(a => a.user_id) || [],
        department_id: expandedProject.department_id || '',
        scheduled_date: expandedProject.scheduled_date || '',
        scheduled_time: expandedProject.scheduled_time || ''
      });
      // Use LOCAL hook instances
      commentsHook.fetchProjectComments(expandedProject.id);
      attachmentsHook.fetchProjectAttachments(expandedProject.id);
      timeTrackingHook.fetchProjectTimeEntries(expandedProject.id);
    }
  }, [expandedProject?.id]); // Only re-run when project ID changes

  // ============================================================================
  // Wrapper functions that use LOCAL state with LOCAL hook mutations
  // ============================================================================
  const handleSaveProject = useCallback(async () => {
    const currentFields = projectFieldsRef.current;
    if (!expandedProject || !currentFields) return;
    const updatedProject = await saveProjectById(expandedProject.id, currentFields);
    if (updatedProject) {
      setExpandedProject(updatedProject);
    }
  }, [expandedProject, saveProjectById]);

  const handlePostComment = useCallback(async () => {
    if (!expandedProject || !newComment.trim()) return;
    await commentsHook.postProjectComment(expandedProject.id, newComment);
    setNewComment('');
  }, [expandedProject, newComment, commentsHook]);

  const handleAttachmentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (expandedProject) {
      attachmentsHook.handleAttachmentUpload(e, expandedProject.id);
    }
  }, [expandedProject, attachmentsHook]);

  const handleStartTimer = useCallback(() => {
    if (expandedProject) {
      timeTrackingHook.startProjectTimer(expandedProject.id);
    }
  }, [expandedProject, timeTrackingHook]);

  const handleDeleteProject = useCallback((project: Project) => {
    deleteProject(project);
    setExpandedProject(null);
    setProjectFields(null);
  }, [deleteProject]);

  const handleOpenActivity = useCallback(() => {
    if (expandedProject) {
      activityHook.fetchProjectActivity(expandedProject.id);
      setActivitySheetOpen(true);
    }
  }, [expandedProject, activityHook]);

  // Create a new project for the current property (without dialog)
  const handleCreateProjectForTurnover = useCallback(async (propertyName: string) => {
    const newProject = await projectsHook.createProjectForProperty(propertyName);
    if (newProject) {
      setExpandedProject(newProject);
    }
  }, [projectsHook]);

  // ============================================================================
  // Task → ProjectDetailPanel: save handler + derived data
  // ============================================================================
  const handleSaveTaskFields = useCallback(async () => {
    if (!fullscreenTask) return;
    const fields = taskEditingFieldsRef.current;
    if (!fields) return;
    const taskId = fullscreenTask.task_id;

    if (fields.status !== fullscreenTask.status) {
      updateTaskAction(taskId, fields.status);
      setFullscreenTask((prev: Task | null) => prev ? { ...prev, status: fields.status as Task['status'] } : null);
    }

    const oldDate = fullscreenTask.scheduled_date || '';
    const oldTime = fullscreenTask.scheduled_time || '';
    if (fields.scheduled_date !== oldDate || fields.scheduled_time !== oldTime) {
      updateTaskSchedule(taskId, fields.scheduled_date || null, fields.scheduled_time || null);
    }

    const oldAssignees = (fullscreenTask.assigned_users || []).map(u => u.user_id).sort().join(',');
    const newAssignees = (fields.assigned_staff || []).sort().join(',');
    if (oldAssignees !== newAssignees) {
      updateTaskAssignment(taskId, fields.assigned_staff || []);
    }

    // Persist title, description, priority, department
    const fieldUpdates: Record<string, unknown> = {};
    const origTitle = fullscreenTask.title || fullscreenTask.template_name || 'Task';
    const origPriority = fullscreenTask.priority || 'medium';
    if (fields.title !== origTitle) fieldUpdates.title = fields.title;
    if (JSON.stringify(fields.description) !== JSON.stringify(fullscreenTask.description || null)) fieldUpdates.description = fields.description;
    if (fields.priority !== origPriority) fieldUpdates.priority = fields.priority;
    if (fields.department_id !== (fullscreenTask.department_id || '')) fieldUpdates.department_id = fields.department_id || null;

    if (Object.keys(fieldUpdates).length > 0) {
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields: fieldUpdates }),
        });
      } catch (err) {
        console.error('Error updating task fields:', err);
      }
    }
  }, [fullscreenTask, updateTaskAction, updateTaskSchedule, updateTaskAssignment, setFullscreenTask]);

  // Map current task to a Project-compatible shape for ProjectDetailPanel
  const taskAsProject: Project | null = fullscreenTask ? {
    id: fullscreenTask.task_id,
    property_name: selectedCard?.property_name || null,
    bin_id: fullscreenTask.bin_id || null,
    title: fullscreenTask.title || fullscreenTask.template_name || 'Task',
    description: fullscreenTask.description || null,
    status: fullscreenTask.status as Project['status'],
    priority: (fullscreenTask.priority || 'medium') as Project['priority'],
    department_id: fullscreenTask.department_id || null,
    department_name: fullscreenTask.department_name || null,
    scheduled_date: fullscreenTask.scheduled_date || null,
    scheduled_time: fullscreenTask.scheduled_time || null,
    project_assignments: (fullscreenTask.assigned_users || []).map(u => ({
      user_id: u.user_id,
      user: { id: u.user_id, name: u.name, avatar: u.avatar, role: u.role }
    })),
    created_at: '',
    updated_at: '',
  } : null;

  // Resolve the template for the checklist slide-over
  const resolvedTaskTemplate = fullscreenTask?.template_id
    ? (taskTemplates[`${fullscreenTask.template_id}__${selectedCard?.property_name}`] as Template
       || taskTemplates[fullscreenTask.template_id] as Template)
    : null;

  const formatTimeDisplay = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, []);

  return (
    <div className="flex h-full overflow-hidden glass-bg-neutral">
      {/* Left Panel - Cards */}
      <div className={`${selectedCard ? 'flex-1 min-w-0 border-r border-neutral-200/30 dark:border-white/10' : 'w-full'} overflow-y-auto hide-scrollbar p-6 space-y-4`}>
        {/* Response Display */}
        {response !== null && (
          <div className="space-y-3">
            {/* Filter Bar */}
            <TurnoverFilterBar
              filters={filters}
              toggleFilter={toggleFilter}
              clearAllFilters={clearAllFilters}
              getActiveFilterCount={getActiveFilterCount}
            />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Turnovers: {Array.isArray(response) ? response.length : 1} total
              </p>
              <div className="flex gap-1 p-1 rounded-xl bg-white/30 dark:bg-white/[0.06] backdrop-blur-sm border border-white/20 dark:border-white/10">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 ${
                    viewMode === 'cards'
                      ? 'bg-white/70 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/30 dark:hover:bg-white/10'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 ${
                    viewMode === 'json'
                      ? 'bg-white/70 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/30 dark:hover:bg-white/10'
                  }`}
                >
                  JSON
                </button>
              </div>
            </div>

            {/* Turnover Cards */}
            <TurnoverCards
              data={Array.isArray(response) ? response : [response]}
              filters={filters}
              sortBy={sortBy}
              onCardClick={(card: Turnover) => {
                setSelectedCard(card);
                setFullscreenTask(null);
              }}
            />
          </div>
        )}

        {loading && (
          <div className="flex justify-center items-center py-20">
            <p className="text-neutral-500 dark:text-neutral-400">Loading turnovers...</p>
          </div>
        )}

        {error && (
          <div className="flex justify-center items-center py-20">
            <p className="text-red-500">Error: {error}</p>
          </div>
        )}

        {!loading && !error && response === null && (
          <div className="flex justify-center items-center py-20">
            <p className="text-neutral-500 dark:text-neutral-400">No turnovers found</p>
          </div>
        )}
      </div>

      {/* Right Panel - Detail View */}
      {selectedCard && (
        <div
          ref={rightPanelRef}
          className="w-[30%] min-w-[320px] flex-shrink-0 h-full overflow-y-auto border-l border-white/20 dark:border-white/10 bg-white/30 dark:bg-white/[0.03] backdrop-blur-xl"
          onScroll={(e) => {
            scrollPositionRef.current = e.currentTarget.scrollTop;
          }}
        >
          {fullscreenTask && taskAsProject && taskEditingFields ? (
            /* Unified Task Detail View (ProjectDetailPanel with checklist) */
            <ProjectDetailPanel
              project={taskAsProject}
              editingFields={taskEditingFields}
              setEditingFields={setTaskEditingFields}
              users={users}
              savingEdit={false}
              onSave={handleSaveTaskFields}
              onDelete={() => {
                if (confirm('Are you sure you want to delete this task?')) {
                  deleteTaskFromCard(fullscreenTask.task_id);
                  setFullscreenTask(null);
                }
              }}
              onClose={() => setFullscreenTask(null)}
              onOpenActivity={() => {}}
              staffOpen={taskStaffOpen}
              setStaffOpen={setTaskStaffOpen}
              // Template / checklist slide-over
              template={resolvedTaskTemplate || undefined}
              formMetadata={fullscreenTask.form_metadata}
              onSaveForm={async (formData) => { await saveTaskForm(fullscreenTask.task_id, formData); }}
              loadingTemplate={loadingTaskTemplate === fullscreenTask.template_id}
              currentUser={currentUser}
              // Turnover context
              onShowTurnover={() => setFullscreenTask(null)}
              // Comments
              comments={taskCommentsHook.projectComments}
              loadingComments={taskCommentsHook.loadingComments}
              newComment={taskNewComment}
              setNewComment={setTaskNewComment}
              postingComment={taskCommentsHook.postingComment}
              onPostComment={async () => {
                if (fullscreenTask && taskNewComment.trim()) {
                  await taskCommentsHook.postProjectComment(fullscreenTask.task_id, taskNewComment, 'task');
                  setTaskNewComment('');
                }
              }}
              // Attachments
              attachments={taskAttachmentsHook.projectAttachments}
              loadingAttachments={taskAttachmentsHook.loadingAttachments}
              uploadingAttachment={taskAttachmentsHook.uploadingAttachment}
              attachmentInputRef={taskAttachmentsHook.attachmentInputRef}
              onAttachmentUpload={(e) => {
                if (fullscreenTask) {
                  taskAttachmentsHook.handleAttachmentUpload(e, fullscreenTask.task_id, 'task');
                }
              }}
              onViewAttachment={(index) => setTaskViewingAttachmentIndex(index)}
              // Time tracking
              activeTimeEntry={taskTimeTrackingHook.activeTimeEntry}
              displaySeconds={taskTimeTrackingHook.displaySeconds}
              formatTime={taskTimeTrackingHook.formatTime}
              onStartTimer={() => {
                if (fullscreenTask) taskTimeTrackingHook.startProjectTimer(fullscreenTask.task_id, 'task');
              }}
              onStopTimer={taskTimeTrackingHook.stopProjectTimer}
              // Bins
              bins={binsHook.bins}
              onBinChange={async (binId) => {
                if (!fullscreenTask) return;
                try {
                  await fetch('/api/update-task-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: fullscreenTask.task_id, fields: { bin_id: binId || null } }),
                  });
                  binsHook.fetchBins();
                } catch (err) {
                  console.error('Error updating bin:', err);
                }
              }}
            />
          ) : (
            /* Turnover Card Detail */
            <div className="flex flex-col h-full">
              {/* Sticky Header - Property Info + Toggle */}
              <div className="sticky top-0 bg-white/40 dark:bg-white/[0.04] backdrop-blur-2xl z-10 border-b border-white/20 dark:border-white/10">
                {/* Top Row: Property name, Guest, Dates, Occupancy, Close button */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    {/* Property & Guest */}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold truncate">{selectedCard.property_name}</h2>
                      {selectedCard.guest_name && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-neutral-500">
                          <svg className="w-3.5 h-3.5 text-blue-400 dark:text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span className="truncate">{selectedCard.guest_name}</span>
                        </div>
                      )}
                    </div>

                    {/* Dates & Occupancy - Compact */}
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">In</div>
                        <div className="font-medium text-blue-600 dark:text-blue-400">
                          {selectedCard.check_in ? new Date(selectedCard.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Out</div>
                        <div className="font-medium text-blue-500 dark:text-blue-400">
                          {selectedCard.check_out ? new Date(selectedCard.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Next In</div>
                        <div className="font-medium text-sky-600 dark:text-sky-400">
                          {selectedCard.next_check_in ? new Date(selectedCard.next_check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      {(() => {
                        const checkIn = selectedCard.check_in ? new Date(selectedCard.check_in) : null;
                        const isUpcoming = checkIn && new Date() < checkIn;

                        if (isUpcoming) {
                          return (
                            <Badge
                              variant="outline"
                              className="text-xs px-2 py-0.5 bg-white/25 dark:bg-white/[0.06] text-neutral-600 dark:text-neutral-400 border-white/30 dark:border-white/10 border-dashed backdrop-blur-sm"
                            >
                              Upcoming
                            </Badge>
                          );
                        }
                        return (
                          <Badge
                            variant="outline"
                            className={`text-xs px-2 py-0.5 backdrop-blur-sm ${
                              selectedCard.occupancy_status === 'occupied'
                                ? 'bg-white/30 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 border-neutral-300/30 dark:border-white/10'
                                : 'bg-white/25 dark:bg-white/[0.06] text-neutral-600 dark:text-neutral-400 border-white/30 dark:border-white/10'
                            }`}
                          >
                            {selectedCard.occupancy_status === 'occupied' ? 'Occupied' : 'Vacant'}
                          </Badge>
                        );
                      })()}
                    </div>

                    {/* Close Button */}
                    <button
                      onClick={closeSelectedCard}
                      className="p-1.5 hover:bg-white/40 dark:hover:bg-white/10 rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Toggle Button Row */}
                <div className="px-4 pb-3">
                  <TooltipProvider delay={300}>
                  <div className="flex justify-center rounded-xl bg-white/20 dark:bg-white/[0.05] backdrop-blur-sm border border-white/20 dark:border-white/10 p-1">
                    <Tooltip>
                      <TooltipTrigger
                        onClick={() => {
                          setRightPanelView('tasks');
                          setExpandedProject(null);
                          setProjectFields(null);
                        }}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                          rightPanelView === 'tasks'
                            ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                            : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/20 dark:hover:bg-white/10'
                        }`}
                      >
                        <DiamondIcon size={14} />
                        <span className="text-xs tabular-nums">{selectedCard.completed_tasks || 0}/{selectedCard.total_tasks || 0}</span>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipPositioner sideOffset={4}>
                          <TooltipPopup className="text-xs">Turnover Tasks</TooltipPopup>
                        </TooltipPositioner>
                      </TooltipPortal>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        onClick={() => setRightPanelView('projects')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                          rightPanelView === 'projects'
                            ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                            : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/20 dark:hover:bg-white/10'
                        }`}
                      >
                        <HexagonIcon size={14} />
                        <span className="text-xs tabular-nums">{projects.filter(p => p.property_name === selectedCard.property_name).length}</span>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipPositioner sideOffset={4}>
                          <TooltipPopup className="text-xs">Property Projects</TooltipPopup>
                        </TooltipPositioner>
                      </TooltipPortal>
                    </Tooltip>
                  </div>
                  </TooltipProvider>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className={`flex-1 overflow-y-auto hide-scrollbar ${rightPanelView === 'tasks' ? 'p-4 space-y-3' : ''}`}>
                {rightPanelView === 'tasks' ? (
                  <TurnoverTaskList
                    selectedCard={selectedCard}
                    users={users}
                    taskTemplates={taskTemplates as Record<string, Template>}
                    availableTemplates={availableTemplates}
                    showAddTaskDialog={showAddTaskDialog}
                    setShowAddTaskDialog={setShowAddTaskDialog}
                    onTaskClick={(task: Task) => setFullscreenTask(task)}
                    onDeleteTask={deleteTaskFromCard}
                    onUpdateSchedule={updateTaskSchedule}
                    onUpdateAssignment={updateTaskAssignment}
                    onAddTask={addTaskToCard}
                    onFetchTemplates={fetchAvailableTemplates}
                    fetchTaskTemplate={fetchTaskTemplate}
                  />
                ) : (
                  <TurnoverProjectsPanel
                    propertyName={selectedCard.property_name}
                    projects={projects}
                    users={users}
                    currentUser={currentUser}
                    expandedProject={expandedProject}
                    projectFields={projectFields}
                    savingProject={savingProjectEdit}
                    staffOpen={staffOpen}
                    setExpandedProject={setExpandedProject}
                    setProjectFields={setProjectFields}
                    setStaffOpen={setStaffOpen}
                    onSaveProject={handleSaveProject}
                    onDeleteProject={handleDeleteProject}
                    onOpenProjectInWindow={onOpenProjectInWindow}
                    onCreateProject={handleCreateProjectForTurnover}
                    // Comments - use LOCAL hook
                    projectComments={commentsHook.projectComments}
                    loadingComments={commentsHook.loadingComments}
                    newComment={newComment}
                    setNewComment={setNewComment}
                    postingComment={commentsHook.postingComment}
                    onPostComment={handlePostComment}
                    // Attachments - use LOCAL hook
                    projectAttachments={attachmentsHook.projectAttachments}
                    loadingAttachments={attachmentsHook.loadingAttachments}
                    uploadingAttachment={attachmentsHook.uploadingAttachment}
                    attachmentInputRef={attachmentsHook.attachmentInputRef}
                    onAttachmentUpload={handleAttachmentUpload}
                    onViewAttachment={setViewingAttachmentIndex}
                    // Time tracking - use LOCAL hook
                    activeTimeEntry={timeTrackingHook.activeTimeEntry}
                    displaySeconds={timeTrackingHook.displaySeconds}
                    formatTime={timeTrackingHook.formatTime}
                    onStartTimer={handleStartTimer}
                    onStopTimer={timeTrackingHook.stopProjectTimer}
                    // Activity
                    onOpenActivity={handleOpenActivity}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attachment Lightbox - use LOCAL hook (projects) */}
      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />

      {/* Attachment Lightbox for tasks */}
      <AttachmentLightbox
        attachments={taskAttachmentsHook.projectAttachments}
        viewingIndex={taskViewingAttachmentIndex}
        onClose={() => setTaskViewingAttachmentIndex(null)}
        onNavigate={setTaskViewingAttachmentIndex}
      />

      {/* Activity Sheet - use LOCAL hook */}
      <ProjectActivitySheet
        open={activitySheetOpen}
        onOpenChange={setActivitySheetOpen}
        activities={activityHook.projectActivity}
        loading={activityHook.loadingActivity}
      />
    </div>
  );
}

// Wrap with memo to prevent unnecessary re-renders
const TurnoversWindow = memo(TurnoversWindowContent);
export default TurnoversWindow;
