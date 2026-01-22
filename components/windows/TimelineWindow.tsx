'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty, getTurnoverStatusColor } from '@/lib/turnoverUtils';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import { FloatingWindow, ScheduledItemsCell } from './timeline';
import { AttachmentLightbox, ProjectActivitySheet } from './projects';
import AssignmentIcon from '@/components/icons/AssignmentIcon';
import HammerIcon from '@/components/icons/HammerIcon';
import type { Project, Task, User, ProjectFormFields } from '@/lib/types';
import type { useProjects } from '@/lib/useProjects';
import type { Template } from '@/components/DynamicCleaningForm';

interface TimelineWindowProps {
  projects: Project[];
  users: User[];
  currentUser: User | null;
  projectsHook: ReturnType<typeof useProjects>;
}

// Type for what's being viewed in the floating window
type FloatingWindowData = {
  type: 'task' | 'project';
  item: Task | Project;
  propertyName: string;
} | null;

export default function TimelineWindow({
  projects,
  users,
  currentUser,
  projectsHook,
}: TimelineWindowProps) {
  // State for the floating window
  const [floatingData, setFloatingData] = useState<FloatingWindowData>(null);

  // ============================================================================
  // LOCAL instances of sub-hooks for projects (independent from other windows)
  // ============================================================================
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const activityHook = useProjectActivity();

  // ============================================================================
  // LOCAL UI State for Projects (independent from other windows)
  // ============================================================================
  const [projectFields, setProjectFields] = useState<ProjectFormFields | null>(null);
  const [newComment, setNewComment] = useState('');
  const [staffOpen, setStaffOpen] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);

  // ============================================================================
  // Task state
  // ============================================================================
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);
  const [localTask, setLocalTask] = useState<Task | null>(null);

  // Ref to track the latest project fields (avoids stale closure issues)
  const projectFieldsRef = useRef<ProjectFormFields | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    projectFieldsRef.current = projectFields;
  }, [projectFields]);

  // ============================================================================
  // Initialize project fields when opening a project in floating window
  // ============================================================================
  // Compute the item ID based on type (tasks use task_id, projects use id)
  const floatingItemId = floatingData?.type === 'task'
    ? (floatingData?.item as Task)?.task_id
    : (floatingData?.item as Project)?.id;

  useEffect(() => {
    if (floatingData?.type === 'project') {
      const project = floatingData.item as Project;
      setProjectFields({
        title: project.title,
        description: project.description || '',
        status: project.status,
        priority: project.priority,
        assigned_staff: project.project_assignments?.[0]?.user_id || '',
        scheduled_start: project.scheduled_start ? project.scheduled_start.split('T')[0] : ''
      });
      commentsHook.fetchProjectComments(project.id);
      attachmentsHook.fetchProjectAttachments(project.id);
      timeTrackingHook.fetchProjectTimeEntries(project.id);
    } else if (floatingData?.type === 'task') {
      const task = floatingData.item as Task;
      setLocalTask(task);
      // Fetch template if needed
      if (task.template_id && !taskTemplates[task.template_id]) {
        fetchTaskTemplate(task.template_id);
      }
    } else {
      setProjectFields(null);
      setLocalTask(null);
    }
  }, [floatingData?.type, floatingItemId]);

  // ============================================================================
  // Task functions
  // ============================================================================
  const fetchTaskTemplate = useCallback(async (templateId: string) => {
    if (taskTemplates[templateId]) {
      return taskTemplates[templateId];
    }

    setLoadingTaskTemplate(templateId);
    try {
      const res = await fetch(`/api/templates/${templateId}`);
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to fetch template');
      }

      setTaskTemplates(prev => ({ ...prev, [templateId]: result.template }));
      return result.template;
    } catch (err) {
      console.error('Error fetching template:', err);
      return null;
    } finally {
      setLoadingTaskTemplate(null);
    }
  }, [taskTemplates]);

  const handleUpdateTaskStatus = useCallback(async (taskId: string, action: string) => {
    try {
      const res = await fetch('/api/update-task-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action })
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Failed to update task action');
      }

      // Update local task state
      setLocalTask(prev => prev ? { ...prev, status: action as Task['status'] } : null);
    } catch (err) {
      console.error('Error updating task status:', err);
    }
  }, []);

  const handleSaveTaskForm = useCallback(async (taskId: string, formData: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/save-task-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, formData })
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Failed to save task form');
      }

      // Update local task state
      setLocalTask(prev => prev ? { ...prev, form_metadata: formData } : null);
    } catch (err) {
      console.error('Error saving task form:', err);
      throw err;
    }
  }, []);

  // ============================================================================
  // Project wrapper functions
  // ============================================================================
  const handleSaveProject = useCallback(async () => {
    const currentFields = projectFieldsRef.current;
    if (floatingData?.type !== 'project' || !currentFields) return;
    const project = floatingData.item as Project;
    const updatedProject = await projectsHook.saveProjectById(project.id, currentFields);
    if (updatedProject) {
      setFloatingData(prev => prev ? { ...prev, item: updatedProject } : null);
    }
  }, [floatingData, projectsHook]);

  const handlePostComment = useCallback(async () => {
    if (floatingData?.type !== 'project' || !newComment.trim()) return;
    const project = floatingData.item as Project;
    await commentsHook.postProjectComment(project.id, newComment);
    setNewComment('');
  }, [floatingData, newComment, commentsHook]);

  const handleAttachmentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (floatingData?.type === 'project') {
      const project = floatingData.item as Project;
      attachmentsHook.handleAttachmentUpload(e, project.id);
    }
  }, [floatingData, attachmentsHook]);

  const handleStartTimer = useCallback(() => {
    if (floatingData?.type === 'project') {
      const project = floatingData.item as Project;
      timeTrackingHook.startProjectTimer(project.id);
    }
  }, [floatingData, timeTrackingHook]);

  const handleDeleteProject = useCallback((project: Project) => {
    projectsHook.deleteProject(project);
    setFloatingData(null);
    setProjectFields(null);
  }, [projectsHook]);

  const handleOpenActivity = useCallback(() => {
    if (floatingData?.type === 'project') {
      const project = floatingData.item as Project;
      activityHook.fetchProjectActivity(project.id);
      setActivitySheetOpen(true);
    }
  }, [floatingData, activityHook]);

  const handleCloseFloatingWindow = useCallback(() => {
    setFloatingData(null);
    setProjectFields(null);
    setLocalTask(null);
  }, []);

  const {
    properties,
    loading,
    selectedReservation,
    setSelectedReservation,
    view,
    setView,
    dateRange,
    goToPrevious,
    goToNext,
    goToToday,
    formatDate,
    isToday,
    getReservationsForProperty,
    getBlockPosition,
    reservations,
  } = useTimeline();

  // Extract all tasks with scheduled_start from reservations, tagged with property_name
  const allScheduledTasks = useMemo(() => {
    const tasks: (Task & { property_name: string })[] = [];
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        if (task.scheduled_start) {
          tasks.push({ ...task, property_name: res.property_name });
        }
      });
    });
    return tasks;
  }, [reservations]);

  // Filter projects that have scheduled_start
  const scheduledProjects = useMemo(() => {
    return projects.filter(p => p.scheduled_start);
  }, [projects]);

  const formatHeaderDate = (date: Date, isTodayDate: boolean) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return (
      <div className="text-center">
        <div className={`text-[11px] ${isTodayDate ? 'text-white/80' : 'text-neutral-600 dark:text-neutral-400'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-xs ${isTodayDate ? 'text-white font-semibold' : 'text-neutral-900 dark:text-white'}`}>
          {month}/{day}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with navigation - fixed at top */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Property Timeline
          </h2>

          <div className="flex items-center gap-4">
            {/* Navigation Controls */}
            <div className="flex items-center gap-2">
              <Button
                onClick={goToPrevious}
                variant="outline"
                size="sm"
              >
                ← Prev
              </Button>
              <Button
                onClick={goToToday}
                variant="outline"
                size="sm"
              >
                Today
              </Button>
              <Button
                onClick={goToNext}
                variant="outline"
                size="sm"
              >
                Next →
              </Button>
            </div>

            {/* View Toggle */}
            <div className="flex gap-2">
              <Button
                onClick={() => setView('week')}
                variant={view === 'week' ? 'default' : 'outline'}
                size="sm"
              >
                Week
              </Button>
              <Button
                onClick={() => setView('month')}
                variant={view === 'month' ? 'default' : 'outline'}
                size="sm"
              >
                Month
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable grid area */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        <div className="overflow-hidden">
          <div
            className="grid border border-neutral-200 dark:border-neutral-700 w-full"
            style={{
              gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-neutral-200 dark:bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-900 dark:text-white sticky left-0 top-0 z-20 border-b border-r border-neutral-300 dark:border-neutral-600">
              Property
            </div>
            {dateRange.map((date, idx) => {
              const isTodayDate = isToday(date);
              return (
                <div key={idx} className={`px-1 py-1 border-b border-r border-neutral-200 dark:border-neutral-700 sticky top-0 z-10 ${isTodayDate ? 'bg-emerald-700' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
                  {formatHeaderDate(date, isTodayDate)}
                </div>
              );
            })}

            {/* Property Rows */}
            {properties.map((property) => {
              const propertyReservations = getReservationsForProperty(property);
              const activeTurnover = getActiveTurnoverForProperty(propertyReservations);

              return (
                <div
                  key={property}
                  className="contents"
                >
                  {/* Property Name with Status Indicator */}
                  <div className="bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-900 dark:text-white sticky left-0 z-10 border-b border-r border-neutral-300 dark:border-neutral-600 flex items-center relative">
                    <span className="truncate pr-24">{property}</span>
                    {activeTurnover && (() => {
                      const propertyProjects = projects.filter(p => p.property_name === activeTurnover.property_name);
                      
                      return (
                        <HoverCard openDelay={100} closeDelay={200}>
                          <HoverCardTrigger asChild>
                            <div className="absolute right-0 top-0 bottom-0 w-28 flex items-center justify-end gap-1.5 pr-2 cursor-default">
                              {/* Status badge */}
                              <div 
                                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getTurnoverStatusColor(activeTurnover.turnover_status)}`}
                              />
                              {/* Tasks icon + count - always show */}
                              <div className="flex items-center gap-0.5 text-neutral-500 dark:text-neutral-400">
                                <AssignmentIcon size={12} />
                                <span className="text-[10px] font-medium w-3 text-right">
                                  {activeTurnover.tasks?.filter(t => t.status !== 'complete').length || 0}
                                </span>
                              </div>
                              {/* Projects icon + count - always show */}
                              <div className="flex items-center gap-0.5 text-neutral-500 dark:text-neutral-400">
                                <HammerIcon size={12} />
                                <span className="text-[10px] font-medium w-3 text-right">
                                  {propertyProjects.filter(p => p.status !== 'complete').length}
                                </span>
                              </div>
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent side="right" align="start" className="w-72 p-0">
                            {/* Header */}
                            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-700">
                              <p className="text-sm font-medium">{property}</p>
                            </div>
                            
                            {/* Tasks Section */}
                            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-700">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Active Turnover: ({activeTurnover.completed_tasks || 0}/{activeTurnover.total_tasks || 0})
                              </p>
                              <div className="space-y-0.5 max-h-40 overflow-y-auto subtle-scrollbar">
                                {activeTurnover.tasks && activeTurnover.tasks.length > 0 ? (
                                  activeTurnover.tasks.map((task) => (
                                    <div 
                                      key={task.task_id} 
                                      className="flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 border-l-2 border-transparent hover:border-blue-500 transition-colors"
                                      onClick={() => setFloatingData({
                                        type: 'task',
                                        item: task,
                                        propertyName: activeTurnover.property_name,
                                      })}
                                    >
                                      <span className="truncate text-sm">{task.template_name || task.type}</span>
                                      <span className={`text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                        task.status === 'complete' 
                                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          : task.status === 'in_progress'
                                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                          : task.status === 'paused'
                                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                          : task.status === 'reopened'
                                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                      }`}>
                                        {task.status?.replace('_', ' ')}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-sm text-muted-foreground">No tasks</p>
                                )}
                              </div>
                            </div>
                            
                            {/* Projects Section */}
                            <div className="px-3 py-2">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Projects ({propertyProjects.length})
                              </p>
                              <div className="space-y-0.5 max-h-40 overflow-y-auto subtle-scrollbar">
                                {propertyProjects.length > 0 ? (
                                  propertyProjects.map((project) => (
                                    <div 
                                      key={project.id} 
                                      className="flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 border-l-2 border-transparent hover:border-amber-500 transition-colors"
                                      onClick={() => setFloatingData({
                                        type: 'project',
                                        item: project,
                                        propertyName: activeTurnover.property_name,
                                      })}
                                    >
                                      <span className="truncate text-sm">{project.title}</span>
                                      <span className={`text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                        project.status === 'complete' 
                                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          : project.status === 'in_progress'
                                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                          : project.status === 'on_hold'
                                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                      }`}>
                                        {project.status?.replace('_', ' ')}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-sm text-muted-foreground">No projects</p>
                                )}
                              </div>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      );
                    })()}
                  </div>

                  {/* Date Cells with embedded reservations */}
                  {dateRange.map((date, idx) => {
                    const isTodayDate = isToday(date);
                    // Only render the block if this is the starting cell
                    const startingReservation = propertyReservations.find(res => {
                      const { start } = getBlockPosition(res.check_in, res.check_out);
                      return start === idx;
                    });

                    return (
                      <div
                        key={idx}
                        className={`border-b border-r border-neutral-200 dark:border-neutral-700 h-[38px] relative overflow-visible ${isTodayDate ? 'bg-emerald-700/20' : 'bg-white dark:bg-neutral-900'}`}
                      >
                        {startingReservation && (() => {
                          const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingReservation.check_in, startingReservation.check_out);

                          // Calculate actual position and width to create gaps between same-day turnovers
                          const leftOffset = startsBeforeRange ? 0 : 50;
                          const rightOffset = endsAfterRange ? 0 : 50;
                          const totalWidth = (span * 100) - leftOffset - rightOffset;

                          // Fixed pixel diagonal for consistent rhombus shape
                          const diagonalPx = 12;
                          const leftDiagonal = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                          const rightDiagonal = endsAfterRange ? '0px' : `${diagonalPx}px`;
                          const clipPath = `polygon(${leftDiagonal} 0%, 100% 0%, calc(100% - ${rightDiagonal}) 100%, 0% 100%)`;

                          return (
                            <div
                              onClick={() => {
                                setSelectedReservation(selectedReservation?.id === startingReservation.id ? null : startingReservation);
                              }}
                              className={`absolute cursor-pointer transition-all duration-150 hover:brightness-110 hover:z-30 text-white text-[11px] font-medium flex items-center bg-neutral-500 hover:bg-neutral-600 ${selectedReservation?.id === startingReservation.id ? 'ring-2 ring-white shadow-lg z-30' : ''}`}
                              style={{
                                left: `${leftOffset}%`,
                                top: 0,
                                bottom: 0,
                                width: `${totalWidth}%`,
                                zIndex: 15,
                                clipPath,
                              }}
                              title={`${startingReservation.guest_name || 'No guest'} - ${formatDate(new Date(startingReservation.check_in))} to ${formatDate(new Date(startingReservation.check_out))}`}
                            >
                              {!startsBeforeRange && (
                                <span className="truncate" style={{ paddingLeft: `${diagonalPx + 6}px`, paddingRight: `${diagonalPx + 6}px` }}>
                                  {startingReservation.guest_name || 'No guest'}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        
                        {/* Scheduled tasks/projects icons */}
                        <ScheduledItemsCell
                          propertyName={property}
                          date={date}
                          tasks={allScheduledTasks}
                          projects={scheduledProjects}
                          onTaskClick={(task) => setFloatingData({
                            type: 'task',
                            item: task,
                            propertyName: property,
                          })}
                          onProjectClick={(project) => setFloatingData({
                            type: 'project',
                            item: project,
                            propertyName: property,
                          })}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating Window */}
      {floatingData && (
        <FloatingWindow
          type={floatingData.type}
          item={floatingData.type === 'task' ? localTask || floatingData.item : floatingData.item}
          propertyName={floatingData.propertyName}
          onClose={handleCloseFloatingWindow}
          // Task props
          currentUser={currentUser}
          taskTemplates={taskTemplates}
          loadingTaskTemplate={loadingTaskTemplate}
          onUpdateTaskStatus={handleUpdateTaskStatus}
          onSaveTaskForm={handleSaveTaskForm}
          setLocalTask={setLocalTask}
          // Project props
          users={users}
          projectFields={projectFields}
          setProjectFields={setProjectFields}
          savingProject={projectsHook.savingProjectEdit}
          onSaveProject={handleSaveProject}
          onDeleteProject={handleDeleteProject}
          onOpenActivity={handleOpenActivity}
          // Comments
          projectComments={commentsHook.projectComments}
          loadingComments={commentsHook.loadingComments}
          newComment={newComment}
          setNewComment={setNewComment}
          postingComment={commentsHook.postingComment}
          onPostComment={handlePostComment}
          // Attachments
          projectAttachments={attachmentsHook.projectAttachments}
          loadingAttachments={attachmentsHook.loadingAttachments}
          uploadingAttachment={attachmentsHook.uploadingAttachment}
          attachmentInputRef={attachmentsHook.attachmentInputRef}
          onAttachmentUpload={handleAttachmentUpload}
          onViewAttachment={(index) => setViewingAttachmentIndex(index)}
          // Time tracking
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

      {/* Attachment Lightbox */}
      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />

      {/* Activity Sheet */}
      <ProjectActivitySheet
        open={activitySheetOpen}
        onOpenChange={setActivitySheetOpen}
        activities={activityHook.projectActivity}
        loading={activityHook.loadingActivity}
      />
    </div>
  );
}
