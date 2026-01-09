'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useProjects } from '@/lib/useProjects';
import {
  ProjectDetailPanel,
  ProjectActivitySheet,
  AttachmentLightbox,
  ProjectFormDialog,
} from './projects';
import type { User, Project, Attachment, Comment } from '@/lib/types';

interface ProjectsWindowProps {
  users: User[];
  currentUser: User | null;
}

// Memoized project card to prevent re-renders when other cards/state change
interface ProjectCardProps {
  project: Project;
  isSelected: boolean;
  hasUnread: boolean;
  onSelect: () => void;
}

const ProjectCard = memo(function ProjectCard({ project, isSelected, hasUnread, onSelect }: ProjectCardProps) {
  return (
    <Card
      className={`group w-full gap-4 !p-4 hover:shadow-lg transition-shadow duration-150 !flex !flex-col cursor-pointer relative ${
        isSelected ? 'ring-1 ring-amber-400/70 shadow-md' : ''
      }`}
      onClick={onSelect}
    >
      {/* New activity badge */}
      {hasUnread && !isSelected && (
        <Badge
          variant="outline"
          className="absolute -top-2 -right-2 z-10 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700 text-[10px] px-1.5 py-0"
        >
          new
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
            <Badge
              className={`px-2.5 py-1 ${
                project.priority === 'urgent' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' :
                project.priority === 'high' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800' :
                project.priority === 'medium' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {project.priority}
            </Badge>
            <Badge
              className={`px-2.5 py-1 ${
                project.status === 'complete' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800' :
                project.status === 'in_progress' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                project.status === 'on_hold' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800' :
                'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {project.status?.replace('_', ' ') || 'not started'}
            </Badge>
          </div>
        </div>
      </CardContent>

      <CardFooter className="mt-auto flex flex-col gap-2">
        <div className="w-full py-1">
          <div className="h-px w-full bg-border/60" />
        </div>
        <div className="flex w-full justify-between text-xs text-muted-foreground/60">
          <div className="flex items-center gap-2">
            {project.assigned_staff && (
              <div className="flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="max-w-[80px] truncate">{project.assigned_staff}</span>
              </div>
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
  hasUnreadActivity: (project: Project) => boolean;
  onSelectProject: (project: Project) => void;
  openCreateProjectDialog: (propertyName?: string) => void;
}

const ProjectList = memo(function ProjectList({
  projects,
  loadingProjects,
  groupedProjects,
  expandedProjectId,
  hasUnreadActivity,
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
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {propertyProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    isSelected={expandedProjectId === project.id}
                    hasUnread={hasUnreadActivity(project)}
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

function ProjectsWindowContent({ users, currentUser }: ProjectsWindowProps) {
  const {
    // Core data
    projects,
    loadingProjects,
    groupedProjects,
    allProperties,

    // Project views
    recordProjectView,
    hasUnreadActivity,

    // Dialog state
    showProjectDialog,
    setShowProjectDialog,
    editingProject,
    projectForm,
    setProjectForm,
    savingProject,
    openCreateProjectDialog,
    saveProject,
    deleteProject,

    // Expanded project
    expandedProject,
    setExpandedProject,
    editingProjectFields,
    setEditingProjectFields,
    savingProjectEdit,
    saveProjectChanges,

    // Comments
    projectComments,
    loadingComments,
    newComment,
    setNewComment,
    postingComment,
    postProjectComment,

    // Attachments
    projectAttachments,
    loadingAttachments,
    uploadingAttachment,
    viewingAttachmentIndex,
    setViewingAttachmentIndex,
    attachmentInputRef,
    handleAttachmentUpload,

    // Time tracking
    activeTimeEntry,
    displaySeconds,
    startProjectTimer,
    stopProjectTimer,
    formatTime,

    // Activity
    projectActivity,
    loadingActivity,
    activityPopoverOpen,
    setActivityPopoverOpen,
    fetchProjectActivity,

    // Popover states
    projectStaffOpen,
    setProjectStaffOpen,
  } = useProjects({ currentUser });

  // Memoized handler for project selection
  const handleProjectSelect = useCallback((project: Project) => {
    if (expandedProject?.id === project.id) {
      setExpandedProject(null);
    } else {
      setExpandedProject(project);
      recordProjectView(project.id);
    }
  }, [expandedProject?.id, setExpandedProject, recordProjectView]);

  const handleOpenActivity = useCallback(() => {
    if (expandedProject) {
      fetchProjectActivity(expandedProject.id);
      setActivityPopoverOpen(true);
    }
  }, [expandedProject, fetchProjectActivity, setActivityPopoverOpen]);

  return (
    <div className="flex h-full">
      {/* Left Panel - Project List */}
      <div className={`${expandedProject ? 'w-1/2' : 'w-full'} h-full overflow-auto transition-[width] duration-200 ease-out hide-scrollbar`}>
        <ProjectList
          projects={projects}
          loadingProjects={loadingProjects}
          groupedProjects={groupedProjects}
          expandedProjectId={expandedProject?.id || null}
          hasUnreadActivity={hasUnreadActivity}
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
          onSave={saveProjectChanges}
          onDelete={deleteProject}
          onClose={() => setExpandedProject(null)}
          onOpenActivity={handleOpenActivity}
          comments={projectComments as Comment[]}
          loadingComments={loadingComments}
          newComment={newComment}
          setNewComment={setNewComment}
          postingComment={postingComment}
          onPostComment={postProjectComment}
          attachments={projectAttachments as Attachment[]}
          loadingAttachments={loadingAttachments}
          uploadingAttachment={uploadingAttachment}
          attachmentInputRef={attachmentInputRef}
          onAttachmentUpload={handleAttachmentUpload}
          onViewAttachment={setViewingAttachmentIndex}
          activeTimeEntry={activeTimeEntry}
          displaySeconds={displaySeconds}
          formatTime={formatTime}
          onStartTimer={startProjectTimer}
          onStopTimer={stopProjectTimer}
          staffOpen={projectStaffOpen}
          setStaffOpen={setProjectStaffOpen}
        />
      )}

      {/* Activity History Sheet */}
      <ProjectActivitySheet
        open={activityPopoverOpen}
        onOpenChange={setActivityPopoverOpen}
        activities={projectActivity}
        loading={loadingActivity}
      />

      {/* Attachment Lightbox */}
      <AttachmentLightbox
        attachments={projectAttachments as Attachment[]}
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
        onSave={saveProject}
      />
    </div>
  );
}

const ProjectsWindow = memo(ProjectsWindowContent);
export default ProjectsWindow;
