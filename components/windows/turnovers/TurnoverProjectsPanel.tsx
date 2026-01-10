'use client';

import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProjectDetailPanel } from '../projects';
import type { Project, Comment, User, ProjectFormFields, Attachment, TimeEntry } from '@/lib/types';

interface TurnoverProjectsPanelProps {
  propertyName: string;
  projects: Project[];
  users: User[];
  currentUser: User | null;
  expandedProject: Project | null;
  projectFields: ProjectFormFields | null;
  savingProject: boolean;
  staffOpen: boolean;
  setExpandedProject: (project: Project | null) => void;
  setProjectFields: (fields: ProjectFormFields | null | ((prev: ProjectFormFields | null) => ProjectFormFields | null)) => void;
  setStaffOpen: (open: boolean) => void;
  onSaveProject: () => void;
  onDeleteProject: (project: Project) => void;
  onOpenProjectInWindow: (project: Project) => void;
  onCreateProject: (propertyName: string) => void;
  // Comments
  projectComments: Comment[];
  loadingComments: boolean;
  newComment: string;
  setNewComment: (comment: string) => void;
  postingComment: boolean;
  onPostComment: () => void;
  // Attachments
  projectAttachments: Attachment[];
  loadingAttachments: boolean;
  uploadingAttachment: boolean;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  onAttachmentUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onViewAttachment: (index: number) => void;
  // Time tracking
  activeTimeEntry: TimeEntry | null;
  displaySeconds: number;
  formatTime: (seconds: number) => string;
  onStartTimer: () => void;
  onStopTimer: () => void;
  // Activity
  onOpenActivity: () => void;
}

function ProjectCard({
  project,
  onClick,
  onOpenInWindow,
}: {
  project: Project;
  onClick: () => void;
  onOpenInWindow: (project: Project) => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 border"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{project.title}</CardTitle>
            {/* Pop-out icon to open in Projects window */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenInWindow(project);
              }}
              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded transition-colors"
              title="Open in Projects window"
            >
              <svg className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
          <Badge
            variant="outline"
            className={`text-xs ${
              project.priority === 'urgent' ? 'bg-red-100 text-red-700 border-red-300' :
              project.priority === 'high' ? 'bg-orange-100 text-orange-700 border-orange-300' :
              project.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
              'bg-neutral-100 text-neutral-600 border-neutral-300'
            }`}
          >
            {project.priority}
          </Badge>
        </div>
        {project.description && (
          <CardDescription className="text-sm line-clamp-2 mt-1">
            {project.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <div className="flex items-center justify-between text-xs">
          <Badge
            variant="outline"
            className={`${
              project.status === 'complete' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
              project.status === 'in_progress' ? 'bg-blue-100 text-blue-700 border-blue-300' :
              project.status === 'on_hold' ? 'bg-red-100 text-red-700 border-red-300' :
              'bg-neutral-100 text-neutral-600 border-neutral-300'
            }`}
          >
            {project.status === 'not_started' ? 'Not Started' :
             project.status === 'in_progress' ? 'In Progress' :
             project.status === 'complete' ? 'Complete' :
             project.status === 'on_hold' ? 'On Hold' : project.status}
          </Badge>
          {project.due_date && (
            <span className="text-neutral-500">
              Due: {new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function TurnoverProjectsPanel({
  propertyName,
  projects,
  users,
  expandedProject,
  projectFields,
  savingProject,
  staffOpen,
  setExpandedProject,
  setProjectFields,
  setStaffOpen,
  onSaveProject,
  onDeleteProject,
  onOpenProjectInWindow,
  onCreateProject,
  // Comments
  projectComments,
  loadingComments,
  newComment,
  setNewComment,
  postingComment,
  onPostComment,
  // Attachments
  projectAttachments,
  loadingAttachments,
  uploadingAttachment,
  attachmentInputRef,
  onAttachmentUpload,
  onViewAttachment,
  // Time tracking
  activeTimeEntry,
  displaySeconds,
  formatTime,
  onStartTimer,
  onStopTimer,
  // Activity
  onOpenActivity,
}: TurnoverProjectsPanelProps) {
  const propertyProjects = projects.filter(p => p.property_name === propertyName);

  const handleProjectClick = (project: Project) => {
    setExpandedProject(project);
  };

  if (expandedProject && projectFields) {
    return (
      <div className="flex flex-col h-full">
        {/* Project Detail Panel - full width override */}
        <div className="flex-1 min-h-0 [&>div]:w-full [&>div]:border-l-0">
          <ProjectDetailPanel
            project={expandedProject}
            editingFields={projectFields}
            setEditingFields={setProjectFields}
            users={users}
            savingEdit={savingProject}
            onSave={onSaveProject}
            onDelete={onDeleteProject}
            onClose={() => {
              setExpandedProject(null);
              setProjectFields(null);
            }}
            onOpenActivity={onOpenActivity}
            // Comments
            comments={projectComments}
            loadingComments={loadingComments}
            newComment={newComment}
            setNewComment={setNewComment}
            postingComment={postingComment}
            onPostComment={onPostComment}
            // Attachments
            attachments={projectAttachments}
            loadingAttachments={loadingAttachments}
            uploadingAttachment={uploadingAttachment}
            attachmentInputRef={attachmentInputRef}
            onAttachmentUpload={onAttachmentUpload}
            onViewAttachment={onViewAttachment}
            // Time tracking
            activeTimeEntry={activeTimeEntry}
            displaySeconds={displaySeconds}
            formatTime={formatTime}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
            // Popover states
            staffOpen={staffOpen}
            setStaffOpen={setStaffOpen}
          />
        </div>
      </div>
    );
  }

  if (propertyProjects.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <p>No projects for this property yet</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => onCreateProject(propertyName)}
        >
          Create Project
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {propertyProjects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onClick={() => handleProjectClick(project)}
          onOpenInWindow={onOpenProjectInWindow}
        />
      ))}
      <Button
        variant="outline"
        className="w-full mt-2"
        onClick={() => onCreateProject(propertyName)}
      >
        Add Project
      </Button>
    </div>
  );
}

