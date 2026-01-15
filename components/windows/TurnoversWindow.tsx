'use client';

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import TurnoverCards from '@/components/TurnoverCards';
import { useTurnovers } from '@/lib/useTurnovers';
import type { useProjects } from '@/lib/useProjects';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import {
  TurnoverFilterBar,
  TaskDetailPanel,
  TurnoverTaskList,
  TurnoverProjectsPanel,
} from './turnovers';
import { AttachmentLightbox, ProjectActivitySheet } from './projects';
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
        description: expandedProject.description || '',
        status: expandedProject.status,
        priority: expandedProject.priority,
        assigned_staff: expandedProject.project_assignments?.[0]?.user_id || '',
        due_date: expandedProject.due_date ? expandedProject.due_date.split('T')[0] : ''
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Panel - Cards */}
      <div className={`${selectedCard ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-700' : 'w-full'} transition-all duration-300 overflow-y-auto hide-scrollbar p-6 space-y-4`}>
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
              <div className="flex gap-2">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    viewMode === 'cards'
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    viewMode === 'json'
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
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
          className="w-1/2 h-full overflow-y-auto border-l border-neutral-200 dark:border-neutral-700 bg-card"
          onScroll={(e) => {
            scrollPositionRef.current = e.currentTarget.scrollTop;
          }}
        >
          {fullscreenTask ? (
            /* Task Template View */
            <TaskDetailPanel
              task={fullscreenTask}
              propertyName={selectedCard.property_name}
              currentUser={currentUser}
              taskTemplates={taskTemplates as Record<string, Template>}
              loadingTaskTemplate={loadingTaskTemplate}
              onClose={() => setFullscreenTask(null)}
              onUpdateStatus={updateTaskAction}
              onSaveForm={saveTaskForm}
              setTask={(task: Task) => setFullscreenTask(task)}
            />
          ) : (
            /* Turnover Card Detail */
            <div className="flex flex-col h-full">
              {/* Sticky Header - Property Info + Toggle */}
              <div className="sticky top-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700">
                {/* Top Row: Property name, Guest, Dates, Occupancy, Close button */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    {/* Property & Guest */}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold truncate">{selectedCard.property_name}</h2>
                      {selectedCard.guest_name && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-neutral-500">
                          <svg className="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                        <div className="font-medium text-red-600 dark:text-red-400">
                          {selectedCard.check_out ? new Date(selectedCard.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Next In</div>
                        <div className="font-medium text-green-600 dark:text-green-400">
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
                              className="text-xs px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300 border-dashed"
                            >
                              Upcoming
                            </Badge>
                          );
                        }
                        return (
                          <Badge
                            variant="outline"
                            className={`text-xs px-2 py-0.5 ${
                              selectedCard.occupancy_status === 'occupied'
                                ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300'
                                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300'
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
                      className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Toggle Button Row */}
                <div className="px-4 pb-3">
                  <div className="flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1">
                    <button
                      onClick={() => {
                        setRightPanelView('tasks');
                        setExpandedProject(null);
                        setProjectFields(null);
                      }}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        rightPanelView === 'tasks'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      Turnover Tasks ({selectedCard.completed_tasks || 0}/{selectedCard.total_tasks || 0})
                    </button>
                    <button
                      onClick={() => setRightPanelView('projects')}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        rightPanelView === 'projects'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      Property Projects ({projects.filter(p => p.property_name === selectedCard.property_name).length})
                    </button>
                  </div>
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

      {/* Attachment Lightbox - use LOCAL hook */}
      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
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
