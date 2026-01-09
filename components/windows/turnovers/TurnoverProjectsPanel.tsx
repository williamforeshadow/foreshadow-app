'use client';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { Project, Comment, User, ProjectFormFields } from '@/lib/types';

interface TurnoverProjectsPanelProps {
  propertyName: string;
  projects: Project[];
  users: User[];
  currentUser: User | null;
  expandedProject: Project | null;
  projectFields: ProjectFormFields | null;
  discussionExpanded: boolean;
  savingProject: boolean;
  projectComments: Comment[];
  newComment: string;
  postingComment: boolean;
  staffOpen: boolean;
  setExpandedProject: (project: Project | null) => void;
  setProjectFields: (fields: ProjectFormFields | null) => void;
  setDiscussionExpanded: (expanded: boolean) => void;
  setNewComment: (comment: string) => void;
  setStaffOpen: (open: boolean) => void;
  onSaveProject: () => void;
  onPostComment: () => void;
  onFetchComments: (projectId: string) => void;
  onOpenProjectInWindow: (project: Project) => void;
  onCreateProject: (propertyName: string) => void;
}

function ProjectDetailView({
  project,
  fields,
  users,
  currentUser,
  discussionExpanded,
  savingProject,
  projectComments,
  newComment,
  postingComment,
  staffOpen,
  setFields,
  setDiscussionExpanded,
  setNewComment,
  setStaffOpen,
  onBack,
  onSave,
  onPostComment,
  onOpenInWindow,
}: {
  project: Project;
  fields: ProjectFormFields;
  users: User[];
  currentUser: User | null;
  discussionExpanded: boolean;
  savingProject: boolean;
  projectComments: Comment[];
  newComment: string;
  postingComment: boolean;
  staffOpen: boolean;
  setFields: (fields: ProjectFormFields | null) => void;
  setDiscussionExpanded: (expanded: boolean) => void;
  setNewComment: (comment: string) => void;
  setStaffOpen: (open: boolean) => void;
  onBack: () => void;
  onSave: () => void;
  onPostComment: () => void;
  onOpenInWindow: (project: Project) => void;
}) {
  const commentsForProject = projectComments.filter((c) => c.project_id === project.id);

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Projects
      </button>

      {/* Project Header with pop-out */}
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-neutral-900 dark:text-white">{project.title}</h4>
        <button
          onClick={() => onOpenInWindow(project)}
          className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded transition-colors"
          title="Open in Projects window"
        >
          <svg className="w-4 h-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* Editable Form */}
      <div className="space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-900 dark:text-white">Title</label>
          <Input
            value={fields.title}
            onChange={(e) => setFields({ ...fields, title: e.target.value })}
            placeholder="Project title"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-900 dark:text-white">Description</label>
          <Textarea
            value={fields.description}
            onChange={(e) => setFields({ ...fields, description: e.target.value })}
            placeholder="Project description (optional)"
            rows={3}
          />
        </div>

        {/* Status & Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-900 dark:text-white">Status</label>
            <Select
              value={fields.status}
              onValueChange={(value) => setFields({ ...fields, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Not Started</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-900 dark:text-white">Priority</label>
            <Select
              value={fields.priority}
              onValueChange={(value) => setFields({ ...fields, priority: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Assigned Staff & Due Date */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-900 dark:text-white">Assigned To</label>
            <Popover open={staffOpen} onOpenChange={setStaffOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={staffOpen}
                  className="w-full justify-between font-normal"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setStaffOpen(!staffOpen);
                  }}
                >
                  {fields.assigned_staff
                    ? users.find((user) => user.id === fields.assigned_staff)?.name || "Unknown"
                    : "Select staff..."}
                  <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command>
                  <CommandInput placeholder="Search staff..." />
                  <CommandList>
                    <CommandEmpty>No staff found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="unassigned"
                        onSelect={() => {
                          setFields({ ...fields, assigned_staff: '' });
                          setStaffOpen(false);
                        }}
                      >
                        <CheckIcon className={cn("mr-2 h-4 w-4", !fields.assigned_staff ? "opacity-100" : "opacity-0")} />
                        Unassigned
                      </CommandItem>
                      {users.map((user) => (
                        <CommandItem
                          key={user.id}
                          value={user.name}
                          onSelect={() => {
                            setFields({ ...fields, assigned_staff: user.id });
                            setStaffOpen(false);
                          }}
                        >
                          <CheckIcon className={cn("mr-2 h-4 w-4", fields.assigned_staff === user.id ? "opacity-100" : "opacity-0")} />
                          {user.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-900 dark:text-white">Due Date</label>
            <Input
              type="date"
              value={fields.due_date}
              onChange={(e) => setFields({ ...fields, due_date: e.target.value })}
            />
          </div>
        </div>

        {/* Discussion Section - Collapsible */}
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <button
            onClick={() => setDiscussionExpanded(!discussionExpanded)}
            className="w-full px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800/50 flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <span className="font-medium text-sm text-neutral-900 dark:text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Discussion
              {commentsForProject.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-1">
                  {commentsForProject.length}
                </Badge>
              )}
            </span>
            <svg
              className={`w-4 h-4 text-neutral-500 transition-transform ${discussionExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {discussionExpanded && (
            <div className="p-4 border-t border-neutral-200 dark:border-neutral-700">
              {/* Comment Input */}
              <div className="flex gap-2 mb-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {currentUser?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
                </div>
                <div className="flex-1">
                  <Textarea
                    placeholder="Add a comment..."
                    rows={2}
                    className="resize-none text-sm"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) {
                        e.preventDefault();
                        onPostComment();
                      }
                    }}
                    disabled={postingComment}
                  />
                  <p className="text-xs text-neutral-400 mt-1">Press Enter to post</p>
                </div>
              </div>

              {/* Comments List */}
              <div className="space-y-3 pt-3 border-t border-neutral-200 dark:border-neutral-700 max-h-48 overflow-y-auto">
                {commentsForProject.length === 0 ? (
                  <p className="text-center text-sm text-neutral-400 py-2">No comments yet</p>
                ) : (
                  commentsForProject.map((comment) => (
                    <div key={comment.id} className="flex gap-2">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                        {(comment.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-xs text-neutral-900 dark:text-white">
                            {comment.user_name || 'Unknown'}
                          </span>
                          <span className="text-xs text-neutral-400">
                            {new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">
                          {comment.comment_content}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Save Button */}
        <Button
          onClick={onSave}
          disabled={savingProject}
          className="w-full"
        >
          {savingProject ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
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
  currentUser,
  expandedProject,
  projectFields,
  discussionExpanded,
  savingProject,
  projectComments,
  newComment,
  postingComment,
  staffOpen,
  setExpandedProject,
  setProjectFields,
  setDiscussionExpanded,
  setNewComment,
  setStaffOpen,
  onSaveProject,
  onPostComment,
  onFetchComments,
  onOpenProjectInWindow,
  onCreateProject,
}: TurnoverProjectsPanelProps) {
  const propertyProjects = projects.filter(p => p.property_name === propertyName);

  const handleProjectClick = (project: Project) => {
    setExpandedProject(project);
    setProjectFields({
      title: project.title,
      description: project.description || '',
      status: project.status,
      priority: project.priority,
      assigned_staff: project.project_assignments?.[0]?.user_id || '',
      due_date: project.due_date || ''
    });
    onFetchComments(project.id);
  };

  if (expandedProject && projectFields) {
    return (
      <ProjectDetailView
        project={expandedProject}
        fields={projectFields}
        users={users}
        currentUser={currentUser}
        discussionExpanded={discussionExpanded}
        savingProject={savingProject}
        projectComments={projectComments}
        newComment={newComment}
        postingComment={postingComment}
        staffOpen={staffOpen}
        setFields={setProjectFields}
        setDiscussionExpanded={setDiscussionExpanded}
        setNewComment={setNewComment}
        setStaffOpen={setStaffOpen}
        onBack={() => {
          setExpandedProject(null);
          setProjectFields(null);
        }}
        onSave={onSaveProject}
        onPostComment={onPostComment}
        onOpenInWindow={onOpenProjectInWindow}
      />
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
        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Project
      </Button>
    </div>
  );
}

