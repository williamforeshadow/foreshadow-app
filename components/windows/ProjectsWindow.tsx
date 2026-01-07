'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DebouncedNativeInput, DebouncedTextarea } from '@/components/ui/debounced-input';
import { Label } from '@/components/ui/label';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ChevronDownIcon, CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjects } from '@/lib/useProjects';

interface User {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
}

interface ProjectsWindowProps {
  users: User[];
  currentUser: any;
}

// Memoized project card to prevent re-renders when other cards/state change
interface ProjectCardProps {
  project: any;
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
  projects: any[];
  loadingProjects: boolean;
  groupedProjects: Record<string, any[]>;
  expandedProjectId: string | null;
  hasUnreadActivity: (project: any) => boolean;
  onSelectProject: (project: any) => void;
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
                      {(propertyProjects as any[]).length} project{(propertyProjects as any[]).length !== 1 ? 's' : ''}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => openCreateProjectDialog(propertyName)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Projects Grid */}
              <div className={`p-4 grid gap-4 auto-rows-fr ${expandedProjectId ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                {(propertyProjects as any[]).map((project: any) => (
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
    discussionExpanded,
    setDiscussionExpanded,

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
    navigateAttachment,

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
    projectDueDateOpen,
    setProjectDueDateOpen,
  } = useProjects({ currentUser });

  // Memoized handler for project selection
  const handleProjectSelect = useCallback((project: any) => {
    if (expandedProject?.id === project.id) {
      setExpandedProject(null);
    } else {
      setExpandedProject(project);
      recordProjectView(project.id);
    }
  }, [expandedProject?.id, setExpandedProject, recordProjectView]);

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
        <div className="w-1/2 h-full flex flex-col border-l border-neutral-200 dark:border-neutral-700 bg-card">
          {/* Header */}
          <div className="flex-shrink-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700 relative">
            <div className="absolute top-2 right-2 flex gap-0.5">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to delete this project?')) {
                    deleteProject(expandedProject);
                  }
                }}
                className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title="Delete project"
              >
                <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button
                onClick={() => setExpandedProject(null)}
                className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
                title="Close"
              >
                <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col space-y-5 px-6 py-6">
              <DebouncedNativeInput
                type="text"
                value={editingProjectFields.title}
                onChange={(value) => setEditingProjectFields(prev => prev ? {...prev, title: value} : null)}
                placeholder="Untitled Project"
                className="text-lg font-semibold bg-transparent border-none outline-none focus:outline-none p-0 flex-1 min-w-0 text-foreground placeholder:text-muted-foreground"
                delay={150}
              />

              <div className="flex items-center justify-between">
                <p className="text-base text-muted-foreground">{expandedProject.property_name}</p>

                <div className="flex items-center gap-2">
                  {/* Status dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="focus:outline-none">
                        <Badge
                          variant="outline"
                          className={cn(
                            "cursor-pointer hover:opacity-80 transition-opacity border-transparent",
                            editingProjectFields.status === 'not_started' && "bg-neutral-500 text-white",
                            editingProjectFields.status === 'in_progress' && "bg-blue-500 text-white",
                            editingProjectFields.status === 'on_hold' && "bg-amber-500 text-white",
                            editingProjectFields.status === 'complete' && "bg-emerald-500 text-white"
                          )}
                        >
                          {editingProjectFields.status?.replace('_', ' ') || 'not started'}
                        </Badge>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.status === 'not_started'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, status: 'not_started'} : null)}
                      >
                        Not Started
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.status === 'in_progress'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, status: 'in_progress'} : null)}
                      >
                        In Progress
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.status === 'on_hold'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, status: 'on_hold'} : null)}
                      >
                        On Hold
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.status === 'complete'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, status: 'complete'} : null)}
                      >
                        Complete
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Priority dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="focus:outline-none">
                        <Badge
                          variant="outline"
                          className={cn(
                            "cursor-pointer hover:opacity-80 transition-opacity border-transparent",
                            editingProjectFields.priority === 'low' && "bg-slate-500 text-white",
                            editingProjectFields.priority === 'medium' && "bg-sky-500 text-white",
                            editingProjectFields.priority === 'high' && "bg-orange-500 text-white",
                            editingProjectFields.priority === 'urgent' && "bg-red-500 text-white"
                          )}
                        >
                          {editingProjectFields.priority}
                        </Badge>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.priority === 'low'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, priority: 'low'} : null)}
                      >
                        Low
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.priority === 'medium'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, priority: 'medium'} : null)}
                      >
                        Medium
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.priority === 'high'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, priority: 'high'} : null)}
                      >
                        High
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={editingProjectFields.priority === 'urgent'}
                        onCheckedChange={() => setEditingProjectFields(prev => prev ? {...prev, priority: 'urgent'} : null)}
                      >
                        Urgent
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Time tracker */}
              {(displaySeconds > 0 || activeTimeEntry) && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-muted-foreground">
                    {formatTime(displaySeconds)}
                  </span>
                  {activeTimeEntry ? (
                    <Button size="sm" variant="outline" onClick={stopProjectTimer}>
                      Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={startProjectTimer}>
                      Resume
                    </Button>
                  )}
                </div>
              )}
              {!activeTimeEntry && displaySeconds === 0 && (
                <Button size="sm" variant="outline" onClick={startProjectTimer} className="w-fit">
                  Start Timer
                </Button>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <DebouncedTextarea
                value={editingProjectFields.description}
                onChange={(value) => setEditingProjectFields(prev => prev ? {...prev, description: value} : null)}
                placeholder="Add a description..."
                rows={3}
                className="resize-none"
                delay={150}
              />
            </div>

            {/* Assigned & Due Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Assigned To</label>
                <Popover open={projectStaffOpen} onOpenChange={setProjectStaffOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                    >
                      {editingProjectFields.assigned_staff
                        ? users.find((user) => user.id === editingProjectFields.assigned_staff)?.name || "Unknown"
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
                              setEditingProjectFields(prev => prev ? {...prev, assigned_staff: ''} : null);
                              setProjectStaffOpen(false);
                            }}
                          >
                            <CheckIcon className={cn("mr-2 h-4 w-4", !editingProjectFields.assigned_staff ? "opacity-100" : "opacity-0")} />
                            Unassigned
                          </CommandItem>
                          {users.map((user) => (
                            <CommandItem
                              key={user.id}
                              value={user.name}
                              onSelect={() => {
                                setEditingProjectFields(prev => prev ? {...prev, assigned_staff: user.id} : null);
                                setProjectStaffOpen(false);
                              }}
                            >
                              <CheckIcon className={cn("mr-2 h-4 w-4", editingProjectFields.assigned_staff === user.id ? "opacity-100" : "opacity-0")} />
                              {user.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Due Date</label>
                <Input
                  type="date"
                  value={editingProjectFields.due_date}
                  onChange={(e) => setEditingProjectFields(prev => prev ? {...prev, due_date: e.target.value} : null)}
                />
              </div>
            </div>

            {/* Comments Section */}
            <div className="space-y-3">
              <button
                onClick={() => setDiscussionExpanded(!discussionExpanded)}
                className="flex items-center justify-between w-full text-left"
              >
                <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  Discussion
                  {projectComments.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {projectComments.length}
                    </Badge>
                  )}
                </span>
                <svg
                  className={`w-4 h-4 text-muted-foreground transition-transform ${discussionExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {discussionExpanded && (
                <div className="space-y-3 pt-2">
                  {/* Comment input */}
                  <div className="flex gap-2">
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
                            postProjectComment();
                          }
                        }}
                        disabled={postingComment}
                      />
                      <p className="text-xs text-muted-foreground mt-1">Press Enter to post</p>
                    </div>
                  </div>

                  {/* Comments list */}
                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {projectComments.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-2">No comments yet</p>
                    ) : (
                      projectComments.map((comment: any) => (
                        <div key={comment.id} className="flex gap-2">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                            {comment.users?.avatar || (comment.users?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-medium text-xs">{comment.users?.name || 'Unknown'}</span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{comment.comment_content}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Save button */}
            <Button
              onClick={saveProjectChanges}
              disabled={savingProjectEdit}
              className="w-full"
            >
              {savingProjectEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}

      {/* Create/Edit Project Dialog */}
      <Dialog open={showProjectDialog} onOpenChange={setShowProjectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProject ? 'Edit Project' : 'New Project'}</DialogTitle>
            <DialogDescription>
              {editingProject ? 'Update the project details below.' : 'Create a new property project.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Property</Label>
              <Select
                value={projectForm.property_name}
                onValueChange={(value) => setProjectForm(prev => ({ ...prev, property_name: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a property" />
                </SelectTrigger>
                <SelectContent>
                  {allProperties.map((prop) => (
                    <SelectItem key={prop} value={prop}>{prop}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={projectForm.title}
                onChange={(e) => setProjectForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Project title"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={projectForm.description}
                onChange={(e) => setProjectForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={projectForm.status}
                  onValueChange={(value) => setProjectForm(prev => ({ ...prev, status: value }))}
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

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={projectForm.priority}
                  onValueChange={(value) => setProjectForm(prev => ({ ...prev, priority: value }))}
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

            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={projectForm.due_date}
                onChange={(e) => setProjectForm(prev => ({ ...prev, due_date: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProjectDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveProject}
              disabled={savingProject || !projectForm.property_name || !projectForm.title}
            >
              {savingProject ? 'Saving...' : editingProject ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ProjectsWindow = memo(ProjectsWindowContent);
export default ProjectsWindow;
