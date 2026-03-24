'use client';

import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { useProjects } from '@/lib/useProjects';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import {
  ProjectDetailPanel,
  ProjectActivitySheet,
  AttachmentLightbox,
  ProjectFormDialog,
} from './projects';
import { ProjectsKanban } from './projects/ProjectsKanban';
import type { User, Project, Attachment, Comment, ProjectFormFields } from '@/lib/types';

interface ProjectsWindowProps {
  users: User[];
  currentUser: User | null;
  projectsHook: ReturnType<typeof useProjects>;
}

function ProjectsWindowContent({ users, currentUser, projectsHook }: ProjectsWindowProps) {
  // ============================================================================
  // LOCAL instances of sub-hooks (independent from TurnoversWindow)
  // ============================================================================
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const activityHook = useProjectActivity();

  // ============================================================================
  // LOCAL UI State (independent from other windows)
  // ============================================================================
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [editingProjectFields, setEditingProjectFields] = useState<ProjectFormFields | null>(null);
  const [newComment, setNewComment] = useState('');
  const [staffOpen, setStaffOpen] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);

  // Ref to track the latest editing fields (avoids stale closure issues)
  const editingFieldsRef = useRef<ProjectFormFields | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    editingFieldsRef.current = editingProjectFields;
  }, [editingProjectFields]);

  // ============================================================================
  // SHARED data from projectsHook (only core project data and mutations)
  // ============================================================================
  const {
    // Core data
    projects,
    loadingProjects,
    allProperties,
    
    // View mode
    viewMode,
    setViewMode,

    // Project views
    recordProjectView,
    getUnreadCommentCount,

    // Dialog state (shared - one dialog for creating projects)
    showProjectDialog,
    setShowProjectDialog,
    editingProject,
    projectForm,
    setProjectForm,
    savingProject,
    openCreateProjectDialog,
    saveProject,
    deleteProject,

    // Saving state
    savingProjectEdit,
    saveProjectById,
    updateProjectField,
  } = projectsHook;

  // ============================================================================
  // Initialize fields when expanding a project
  // ============================================================================
  useEffect(() => {
    if (expandedProject) {
      setEditingProjectFields({
        title: expandedProject.title,
        description: expandedProject.description || '',
        status: expandedProject.status,
        priority: expandedProject.priority,
        assigned_staff: expandedProject.project_assignments?.[0]?.user_id || '',
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
    const currentFields = editingFieldsRef.current;
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
    if (!expandedProject) return;
    attachmentsHook.handleAttachmentUpload(e, expandedProject.id);
  }, [expandedProject, attachmentsHook]);

  const handleStartTimer = useCallback(() => {
    if (!expandedProject) return;
    timeTrackingHook.startProjectTimer(expandedProject.id);
  }, [expandedProject, timeTrackingHook]);

  const handleOpenActivity = useCallback(() => {
    if (expandedProject) {
      activityHook.fetchProjectActivity(expandedProject.id);
      setActivityPopoverOpen(true);
    }
  }, [expandedProject, activityHook]);

  // Memoized handler for project selection
  const handleProjectSelect = useCallback((project: Project) => {
    if (expandedProject?.id === project.id) {
      setExpandedProject(null);
    } else {
      setExpandedProject(project);
      recordProjectView(project.id);
    }
  }, [expandedProject?.id, recordProjectView]);

  // Handle creating a new project - auto-expands the project after creation
  const handleCreateProject = useCallback(async () => {
    const newProject = await saveProject();
    if (newProject && !editingProject) {
      // Only auto-expand for new projects, not edits
      setExpandedProject(newProject);
    }
  }, [saveProject, editingProject]);

  // Handle kanban column moves (drag-and-drop between columns)
  const handleColumnMove = useCallback(
    (projectId: string, field: string, value: string) => {
      updateProjectField(projectId, field, value);
    },
    [updateProjectField]
  );

  return (
    <div className="flex h-full">
      {/* Left Panel - Kanban Board */}
      <div className={`${expandedProject ? 'w-2/3' : 'w-full'} h-full flex flex-col transition-[width] duration-200 ease-out`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Projects
          </h3>
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-lg p-0.5">
              {(['property', 'status', 'priority'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === mode
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {mode === 'property' ? 'Property' : mode === 'status' ? 'Status' : 'Priority'}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => openCreateProjectDialog()}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New Project
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        {loadingProjects ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-neutral-500">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                No projects yet. Create your first project!
              </p>
              <Button onClick={() => openCreateProjectDialog()}>
                Create First Project
              </Button>
            </div>
          </div>
        ) : (
          <ProjectsKanban
            projects={projects}
            viewMode={viewMode}
            allProperties={allProperties}
            onProjectClick={handleProjectSelect}
            expandedProjectId={expandedProject?.id || null}
            getUnreadCommentCount={getUnreadCommentCount}
            onColumnMove={handleColumnMove}
          />
        )}
      </div>

      {/* Right Panel - Project Detail */}
      {expandedProject && editingProjectFields && (
        <div className="w-1/3 flex-shrink-0 border-l border-neutral-200 dark:border-neutral-700">
        <ProjectDetailPanel
          project={expandedProject}
          editingFields={editingProjectFields}
          setEditingFields={setEditingProjectFields}
          users={users}
          savingEdit={savingProjectEdit}
          onSave={handleSaveProject}
          onDelete={deleteProject}
          onClose={() => setExpandedProject(null)}
          onOpenActivity={handleOpenActivity}
          // Comments - use LOCAL hook
          comments={commentsHook.projectComments as Comment[]}
          loadingComments={commentsHook.loadingComments}
          newComment={newComment}
          setNewComment={setNewComment}
          postingComment={commentsHook.postingComment}
          onPostComment={handlePostComment}
          // Attachments - use LOCAL hook
          attachments={attachmentsHook.projectAttachments as Attachment[]}
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
          // Popover states
          staffOpen={staffOpen}
          setStaffOpen={setStaffOpen}
        />
        </div>
      )}

      {/* Activity History Sheet - use LOCAL hook */}
      <ProjectActivitySheet
        open={activityPopoverOpen}
        onOpenChange={setActivityPopoverOpen}
        activities={activityHook.projectActivity}
        loading={activityHook.loadingActivity}
      />

      {/* Attachment Lightbox - use LOCAL hook */}
      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments as Attachment[]}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />

      {/* Create/Edit Project Dialog */}
      <ProjectFormDialog
        open={showProjectDialog}
        onOpenChange={setShowProjectDialog}
        editingProject={editingProject}
        formData={projectForm}
        setFormData={setProjectForm}
        allProperties={allProperties}
        saving={savingProject}
        onSave={handleCreateProject}
      />
    </div>
  );
}

const ProjectsWindow = memo(ProjectsWindowContent);
export default ProjectsWindow;
