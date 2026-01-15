'use client';

import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import type { User, Project, Attachment, Comment, ProjectFormFields } from '@/lib/types';

interface ProjectsWindowProps {
  users: User[];
  currentUser: User | null;
  projectsHook: ReturnType<typeof useProjects>;
}

// Memoized project card to prevent re-renders when other cards/state change
interface ProjectCardProps {
  project: Project;
  isSelected: boolean;
  unreadCount: number;
  onSelect: () => void;
}

const ProjectCard = memo(function ProjectCard({ project, isSelected, unreadCount, onSelect }: ProjectCardProps) {
  return (
    <Card
      className={`group w-[280px] gap-4 !p-4 hover:shadow-lg transition-shadow duration-150 !flex !flex-col cursor-pointer relative ${
        isSelected ? 'ring-1 ring-amber-400/70 shadow-md' : ''
      }`}
      onClick={onSelect}
    >
      {/* Unread comments badge */}
      {unreadCount > 0 && !isSelected && (
        <Badge
          className="absolute -top-2 -right-2 z-10 bg-red-500 text-white border-transparent text-[10px] px-1.5 py-0 min-w-[18px] text-center"
        >
          {unreadCount}
        </Badge>
      )}
      <CardHeader className="min-h-[4.5rem]">
        <CardTitle className="text-base leading-tight line-clamp-2">{project.title}</CardTitle>
        <CardDescription className="line-clamp-2 text-muted-foreground">
          {project.description || '\u00A0'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-grow">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status badge first */}
            <Badge
              variant="outline"
              className={`px-2 py-0.5 text-xs border-transparent ${
                project.status === 'complete' ? 'bg-emerald-500 text-white' :
                project.status === 'in_progress' ? 'bg-blue-500 text-white' :
                project.status === 'on_hold' ? 'bg-amber-500 text-white' :
                'bg-neutral-500 text-white'
              }`}
            >
              {(project.status?.replace('_', ' ') || 'not started').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </Badge>
            {/* Priority badge second */}
            <Badge
              variant="outline"
              className={`px-2 py-0.5 text-xs border-transparent ${
                project.priority === 'urgent' ? 'bg-red-500 text-white' :
                project.priority === 'high' ? 'bg-orange-500 text-white' :
                project.priority === 'medium' ? 'bg-sky-500 text-white' :
                'bg-slate-500 text-white'
              }`}
            >
              {project.priority ? project.priority.charAt(0).toUpperCase() + project.priority.slice(1) : 'Low'}
            </Badge>
          </div>
        </div>
      </CardContent>

      <CardFooter className="mt-auto flex flex-col gap-2">
        <div className="w-full py-1">
          <div className="h-px w-full bg-border/60" />
        </div>
        <div className="flex w-full justify-between text-xs text-muted-foreground/60">
          {/* Assigned Users Avatars */}
          <div className="flex items-center">
            {project.project_assignments && project.project_assignments.length > 0 ? (
              <div className="flex items-center">
                {project.project_assignments.slice(0, 3).map((assignment, index) => (
                  <div
                    key={assignment.user_id}
                    className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[10px] font-medium text-neutral-600 dark:text-neutral-300 border-2 border-card"
                    style={{ marginLeft: index > 0 ? '-6px' : '0' }}
                    title={assignment.user?.name || 'Unknown'}
                  >
                    {(assignment.user?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                ))}
                {project.project_assignments.length > 3 && (
                  <div
                    className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground border-2 border-card"
                    style={{ marginLeft: '-6px' }}
                  >
                    +{project.project_assignments.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-6 h-6" />
            )}
          </div>
          {project.due_date && (
            <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 ${
              new Date(project.due_date) < new Date() ? 'text-red-500' :
              new Date(project.due_date) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) ? 'text-amber-500' :
              ''
            }`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
  );
});

// Memoized project list component - won't re-render when detail panel state changes
interface ProjectListProps {
  projects: Project[];
  loadingProjects: boolean;
  groupedProjects: Record<string, Project[]>;
  expandedProjectId: string | null;
  getUnreadCommentCount: (project: Project) => number;
  onSelectProject: (project: Project) => void;
  openCreateProjectDialog: (propertyName?: string) => void;
}

const ProjectList = memo(function ProjectList({
  projects,
  loadingProjects,
  groupedProjects,
  expandedProjectId,
  getUnreadCommentCount,
  onSelectProject,
  openCreateProjectDialog,
}: ProjectListProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 bg-white dark:bg-neutral-900 z-10 pb-2">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
          Property Projects
        </h3>
        <Button size="sm" onClick={() => openCreateProjectDialog()}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          New Project
        </Button>
      </div>

      {/* Projects List */}
      {loadingProjects ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-neutral-500">Loading projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400 mb-4">
            No projects yet. Create your first property project!
          </p>
          <Button onClick={() => openCreateProjectDialog()}>
            Create First Project
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedProjects).sort().map(([propertyName, propertyProjects]) => (
            <div key={propertyName} className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm">
              {/* Property Header */}
              <div className="px-4 py-3 bg-gradient-to-r from-neutral-50 to-neutral-100 dark:from-neutral-800 dark:to-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-neutral-900 dark:text-white">
                    {propertyName}
                  </h4>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {propertyProjects.length} {propertyProjects.length === 1 ? 'project' : 'projects'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreateProjectDialog(propertyName);
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Property Projects Grid */}
              <div className="p-4 flex flex-wrap gap-4">
                {propertyProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    isSelected={expandedProjectId === project.id}
                    unreadCount={getUnreadCommentCount(project)}
                    onSelect={() => onSelectProject(project)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

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
    groupedProjects,
    allProperties,

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

  return (
    <div className="flex h-full">
      {/* Left Panel - Project List */}
      <div className={`${expandedProject ? 'w-1/2' : 'w-full'} h-full overflow-auto transition-[width] duration-200 ease-out hide-scrollbar`}>
        <ProjectList
          projects={projects}
          loadingProjects={loadingProjects}
          groupedProjects={groupedProjects}
          expandedProjectId={expandedProject?.id || null}
          getUnreadCommentCount={getUnreadCommentCount}
          onSelectProject={handleProjectSelect}
          openCreateProjectDialog={openCreateProjectDialog}
        />
      </div>

      {/* Right Panel - Project Detail */}
      {expandedProject && editingProjectFields && (
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
