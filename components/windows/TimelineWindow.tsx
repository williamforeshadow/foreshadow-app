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
import { ScheduledItemsCell, DayKanban } from './timeline';
import { AttachmentLightbox, ProjectActivitySheet, ProjectDetailPanel } from './projects';
import { TaskDetailPanel, TurnoverTaskList, TurnoverProjectsPanel } from './turnovers';
import AssignmentIcon from '@/components/icons/AssignmentIcon';
import HammerIcon from '@/components/icons/HammerIcon';
import Rhombus16FilledIcon from '@/components/icons/Rhombus16FilledIcon';
import RectangleStackIcon from '@/components/icons/RectangleStackIcon';
import type { Project, Task, User, ProjectFormFields, Turnover, TaskTemplate } from '@/lib/types';
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
  type: 'task' | 'project' | 'turnover';
  item: Task | Project | Turnover;
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
  
  // State for view mode (grid vs kanban)
  const [viewMode, setViewMode] = useState<'grid' | 'kanban'>('grid');
  
  // State for kanban - use current date as default when in kanban view mode
  const [kanbanDate, setKanbanDate] = useState<Date>(new Date());

  // ============================================================================
  // Timeline hook (needed early for fetchReservations)
  // ============================================================================
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
    setReservations,
  } = useTimeline();

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

  // ============================================================================
  // Turnover detail state
  // ============================================================================
  const [turnoverRightPanelView, setTurnoverRightPanelView] = useState<'tasks' | 'projects'>('tasks');
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [expandedProjectInTurnover, setExpandedProjectInTurnover] = useState<Project | null>(null);
  const [turnoverProjectFields, setTurnoverProjectFields] = useState<ProjectFormFields | null>(null);
  const [turnoverStaffOpen, setTurnoverStaffOpen] = useState(false);
  const [turnoverNewComment, setTurnoverNewComment] = useState('');

  // Separate hooks for turnover projects panel
  const turnoverCommentsHook = useProjectComments({ currentUser });
  const turnoverAttachmentsHook = useProjectAttachments({ currentUser });
  const turnoverTimeTrackingHook = useProjectTimeTracking({ currentUser });
  const turnoverActivityHook = useProjectActivity();
  const [turnoverActivitySheetOpen, setTurnoverActivitySheetOpen] = useState(false);
  const [turnoverViewingAttachmentIndex, setTurnoverViewingAttachmentIndex] = useState<number | null>(null);

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
  // Turnover task handlers
  // ============================================================================
  const updateTurnoverTaskAssignment = useCallback(async (taskId: string, userIds: string[]) => {
    try {
      const res = await fetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userIds })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update task assignment');

      // Update task in reservations
      const assignedUsers = (result.data?.task_assignments || []).map((ta: { user_id: string; users?: { name?: string; avatar?: string; role?: string } }) => ({
        user_id: ta.user_id,
        name: ta.users?.name || '',
        avatar: ta.users?.avatar || '',
        role: ta.users?.role || ''
      }));

      setReservations(prev => prev.map(reservation => ({
        ...reservation,
        tasks: (reservation.tasks || []).map((task: Task) => 
          task.task_id === taskId ? { ...task, assigned_users: assignedUsers } : task
        )
      })));

      // Update floatingData if viewing a turnover
      if (floatingData?.type === 'turnover') {
        setFloatingData(prev => {
          if (!prev || prev.type !== 'turnover') return prev;
          const turnover = prev.item as Turnover;
          return {
            ...prev,
            item: {
              ...turnover,
              tasks: turnover.tasks.map(task => 
                task.task_id === taskId ? { ...task, assigned_users: assignedUsers } : task
              )
            }
          };
        });
      }
    } catch (err) {
      console.error('Error updating task assignment:', err);
    }
  }, [floatingData, setReservations]);

  const updateTurnoverTaskSchedule = useCallback(async (taskId: string, dateTime: string | null) => {
    try {
      const res = await fetch('/api/update-task-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, scheduledStart: dateTime })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update task schedule');

      // Update task in reservations
      setReservations(prev => prev.map(reservation => ({
        ...reservation,
        tasks: (reservation.tasks || []).map((task: Task) => 
          task.task_id === taskId ? { ...task, scheduled_start: dateTime } : task
        )
      })));

      // Update floatingData if viewing a turnover
      if (floatingData?.type === 'turnover') {
        setFloatingData(prev => {
          if (!prev || prev.type !== 'turnover') return prev;
          const turnover = prev.item as Turnover;
          return {
            ...prev,
            item: {
              ...turnover,
              tasks: turnover.tasks.map(task => 
                task.task_id === taskId ? { ...task, scheduled_start: dateTime } : task
              )
            }
          };
        });
      }
    } catch (err) {
      console.error('Error updating task schedule:', err);
    }
  }, [floatingData, setReservations]);

  const fetchAvailableTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const result = await res.json();
      if (res.ok && result.data) {
        setAvailableTemplates(result.data);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  }, []);

  const addTaskToTurnover = useCallback(async (templateId: string) => {
    if (floatingData?.type !== 'turnover') return;
    const turnover = floatingData.item as Turnover;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: turnover.id,
          template_id: templateId
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to add task');

      const newTask = result.data as Task;

      // Update reservations
      setReservations(prev => prev.map(reservation => {
        if (reservation.id === turnover.id) {
          const updatedTasks = [...(reservation.tasks || []), newTask];
          return {
            ...reservation,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter((t: Task) => t.status === 'complete').length,
          };
        }
        return reservation;
      }));

      // Update floatingData
      setFloatingData(prev => {
        if (!prev || prev.type !== 'turnover') return prev;
        const t = prev.item as Turnover;
        const updatedTasks = [...t.tasks, newTask];
        return {
          ...prev,
          item: {
            ...t,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter(task => task.status === 'complete').length,
          }
        };
      });

      setShowAddTaskDialog(false);
    } catch (err) {
      console.error('Error adding task:', err);
    }
  }, [floatingData, setReservations]);

  const deleteTaskFromTurnover = useCallback(async (taskId: string) => {
    if (floatingData?.type !== 'turnover') return;
    const turnover = floatingData.item as Turnover;

    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete task');

      // Update reservations
      setReservations(prev => prev.map(reservation => {
        if (reservation.id === turnover.id) {
          const updatedTasks = (reservation.tasks || []).filter((t: Task) => t.task_id !== taskId);
          return {
            ...reservation,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter((t: Task) => t.status === 'complete').length,
          };
        }
        return reservation;
      }));

      // Update floatingData
      setFloatingData(prev => {
        if (!prev || prev.type !== 'turnover') return prev;
        const t = prev.item as Turnover;
        const updatedTasks = t.tasks.filter(task => task.task_id !== taskId);
        return {
          ...prev,
          item: {
            ...t,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter(task => task.status === 'complete').length,
          }
        };
      });
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  }, [floatingData, setReservations]);

  const handleTurnoverTaskClick = useCallback((task: Task) => {
    if (floatingData?.type !== 'turnover') return;
    // Switch to task view within the same panel
    setFloatingData({
      type: 'task',
      item: task,
      propertyName: floatingData.propertyName,
    });
    setLocalTask(task);
    if (task.template_id && !taskTemplates[task.template_id]) {
      fetchTaskTemplate(task.template_id);
    }
  }, [floatingData, taskTemplates, fetchTaskTemplate]);

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
    setTurnoverRightPanelView('tasks');
    setExpandedProjectInTurnover(null);
    setTurnoverProjectFields(null);
  }, []);

  // ============================================================================
  // Show turnover handler - called when clicking "Associated Turnover" button
  // ============================================================================
  const handleShowTurnover = useCallback(() => {
    if (!floatingData || floatingData.type !== 'task') return;
    
    const task = floatingData.item as Task;
    
    // Find the turnover that contains this task
    const associatedTurnover = reservations.find((r: Turnover) => 
      r.tasks?.some((t: Task) => t.task_id === task.task_id)
    );
    
    if (associatedTurnover) {
      setFloatingData({
        type: 'turnover',
        item: associatedTurnover,
        propertyName: floatingData.propertyName,
      });
      setTurnoverRightPanelView('tasks');
      setExpandedProjectInTurnover(null);
      setTurnoverProjectFields(null);
      setLocalTask(null);
      setProjectFields(null);
    }
  }, [floatingData, reservations]);

  // ============================================================================
  // Turnover projects panel handlers
  // ============================================================================
  const turnoverProjectFieldsRef = useRef<ProjectFormFields | null>(null);
  useEffect(() => {
    turnoverProjectFieldsRef.current = turnoverProjectFields;
  }, [turnoverProjectFields]);

  useEffect(() => {
    if (expandedProjectInTurnover) {
      setTurnoverProjectFields({
        title: expandedProjectInTurnover.title,
        description: expandedProjectInTurnover.description || '',
        status: expandedProjectInTurnover.status,
        priority: expandedProjectInTurnover.priority,
        assigned_staff: expandedProjectInTurnover.project_assignments?.[0]?.user_id || '',
        scheduled_start: expandedProjectInTurnover.scheduled_start ? expandedProjectInTurnover.scheduled_start.split('T')[0] : ''
      });
      turnoverCommentsHook.fetchProjectComments(expandedProjectInTurnover.id);
      turnoverAttachmentsHook.fetchProjectAttachments(expandedProjectInTurnover.id);
      turnoverTimeTrackingHook.fetchProjectTimeEntries(expandedProjectInTurnover.id);
    }
  }, [expandedProjectInTurnover?.id]);

  const handleTurnoverSaveProject = useCallback(async () => {
    const currentFields = turnoverProjectFieldsRef.current;
    if (!expandedProjectInTurnover || !currentFields) return;
    const updatedProject = await projectsHook.saveProjectById(expandedProjectInTurnover.id, currentFields);
    if (updatedProject) {
      setExpandedProjectInTurnover(updatedProject);
    }
  }, [expandedProjectInTurnover, projectsHook]);

  const handleTurnoverPostComment = useCallback(async () => {
    if (!expandedProjectInTurnover || !turnoverNewComment.trim()) return;
    await turnoverCommentsHook.postProjectComment(expandedProjectInTurnover.id, turnoverNewComment);
    setTurnoverNewComment('');
  }, [expandedProjectInTurnover, turnoverNewComment, turnoverCommentsHook]);

  const handleTurnoverAttachmentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (expandedProjectInTurnover) {
      turnoverAttachmentsHook.handleAttachmentUpload(e, expandedProjectInTurnover.id);
    }
  }, [expandedProjectInTurnover, turnoverAttachmentsHook]);

  const handleTurnoverStartTimer = useCallback(() => {
    if (expandedProjectInTurnover) {
      turnoverTimeTrackingHook.startProjectTimer(expandedProjectInTurnover.id);
    }
  }, [expandedProjectInTurnover, turnoverTimeTrackingHook]);

  const handleTurnoverDeleteProject = useCallback((project: Project) => {
    projectsHook.deleteProject(project);
    setExpandedProjectInTurnover(null);
    setTurnoverProjectFields(null);
  }, [projectsHook]);

  const handleTurnoverOpenActivity = useCallback(() => {
    if (expandedProjectInTurnover) {
      turnoverActivityHook.fetchProjectActivity(expandedProjectInTurnover.id);
      setTurnoverActivitySheetOpen(true);
    }
  }, [expandedProjectInTurnover, turnoverActivityHook]);

  const handleTurnoverCreateProject = useCallback(async (propertyName: string) => {
    const newProject = await projectsHook.createProjectForProperty(propertyName);
    if (newProject) {
      setExpandedProjectInTurnover(newProject);
    }
  }, [projectsHook]);

  // Handle assignment changes from kanban drag/drop
  const handleKanbanAssignmentChange = useCallback(async (
    itemType: 'task' | 'project',
    itemId: string,
    newUserId: string | null
  ) => {
    try {
      if (itemType === 'task') {
        // Update task assignment
        const res = await fetch('/api/update-task-assignment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: itemId,
            userIds: newUserId ? [newUserId] : []
          })
        });
        
        if (!res.ok) {
          const result = await res.json();
          throw new Error(result.error || 'Failed to update task assignment');
        }
        
        // Optimistic update: update the task's assignments in local state
        const assignedUser = users.find((u: any) => u.id === newUserId);
        setReservations(prev => prev.map(reservation => ({
          ...reservation,
          tasks: (reservation.tasks || []).map((task: Task) => 
            task.task_id === itemId
              ? {
                  ...task,
                  assigned_users: newUserId 
                    ? [{ 
                        user_id: newUserId, 
                        name: assignedUser?.name || '',
                        avatar: assignedUser?.avatar || '',
                        role: assignedUser?.role || ''
                      }]
                    : []
                }
              : task
          )
        })));
      } else {
        // Update project assignment
        const res = await fetch(`/api/projects/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigned_user_ids: newUserId ? [newUserId] : [],
            user_id: currentUser?.id // for activity logging
          })
        });
        
        const result = await res.json();
        
        if (!res.ok) {
          throw new Error(result.error || 'Failed to update project assignment');
        }
        
        // Update the shared projects state (same pattern as saveProjectById)
        if (result.data) {
          projectsHook.setProjects(prev => 
            prev.map(p => p.id === itemId ? result.data : p)
          );
        }
      }
    } catch (err) {
      console.error('Error updating assignment:', err);
    }
  }, [currentUser?.id, projectsHook, setReservations, users]);

  // Extract ALL tasks from reservations, tagged with property_name (for DynamicBoard)
  const allTasksWithProperty = useMemo(() => {
    const tasks: (Task & { property_name: string })[] = [];
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        tasks.push({ ...task, property_name: res.property_name });
      });
    });
    return tasks;
  }, [reservations]);

  // Extract tasks with scheduled_start (for kanban user columns)
  const allScheduledTasks = useMemo(() => {
    return allTasksWithProperty.filter(task => task.scheduled_start);
  }, [allTasksWithProperty]);

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
    <div className="h-full flex flex-col relative">
      {/* Header with navigation - fixed at top */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center gap-4 mb-2">
          {/* View Mode Icons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-white' 
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
              title="Grid View"
            >
              <Rhombus16FilledIcon size={18} />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'kanban' 
                  ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-white' 
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
              title="Kanban View"
            >
              <RectangleStackIcon size={18} />
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Navigation Controls */}
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  if (viewMode === 'grid') {
                    goToPrevious();
                  } else {
                    // In kanban mode, go to previous day
                    const newDate = new Date(kanbanDate);
                    newDate.setDate(newDate.getDate() - 1);
                    setKanbanDate(newDate);
                  }
                }}
                variant="outline"
                size="sm"
              >
                ← Prev
              </Button>
              <Button
                onClick={() => {
                  if (viewMode === 'grid') {
                    goToToday();
                  } else {
                    setKanbanDate(new Date());
                  }
                }}
                variant="outline"
                size="sm"
              >
                Today
              </Button>
              <Button
                onClick={() => {
                  if (viewMode === 'grid') {
                    goToNext();
                  } else {
                    // In kanban mode, go to next day
                    const newDate = new Date(kanbanDate);
                    newDate.setDate(newDate.getDate() + 1);
                    setKanbanDate(newDate);
                  }
                }}
                variant="outline"
                size="sm"
              >
                Next →
              </Button>
            </div>

            {/* View Toggle - only show in grid mode */}
            {viewMode === 'grid' && (
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
            )}
          </div>
        </div>
      </div>

      {/* Content Area - Grid or Kanban based on viewMode */}
      {viewMode === 'grid' ? (
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
                <div 
                  key={idx} 
                  className={`px-1 py-1 border-b border-r border-neutral-200 dark:border-neutral-700 sticky top-0 z-10 cursor-pointer transition-colors ${
                    isTodayDate 
                      ? 'bg-emerald-700 hover:bg-emerald-600' 
                      : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                  onClick={() => {
                    setKanbanDate(date);
                    setViewMode('kanban');
                  }}
                >
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
                        <HoverCard openDelay={0} closeDelay={0}>
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
                          <HoverCardContent side="right" align="start" sideOffset={-8} className="w-72 p-0">
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
                        className={`border-b border-r border-neutral-200 dark:border-neutral-700 h-[30px] relative overflow-visible ${isTodayDate ? 'bg-emerald-700/20' : 'bg-white dark:bg-neutral-900'}`}
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
                          viewMode={view}
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
      ) : (
        /* Full-screen Kanban View */
        <div className="flex-1 overflow-hidden">
          <DayKanban
            date={kanbanDate}
            tasks={allScheduledTasks}
            projects={scheduledProjects}
            users={users as any}
            onClose={() => setViewMode('grid')}
            onTaskClick={(task, propertyName) => {
              setFloatingData({
                type: 'task',
                item: task,
                propertyName,
              });
            }}
            onProjectClick={(project, propertyName) => {
              setFloatingData({
                type: 'project',
                item: project,
                propertyName,
              });
            }}
            onAssignmentChange={handleKanbanAssignmentChange}
            allTasks={allTasksWithProperty}
            allProjects={projects}
            properties={properties}
            isFullScreen
          />
        </div>
      )}

      {/* Right Panel Overlay - Detail View */}
      {floatingData && (
        <div 
          className="absolute top-0 right-0 h-full w-[30%] min-w-[320px] bg-card border-l border-neutral-200 dark:border-neutral-700 shadow-xl z-30 overflow-y-auto"
          onWheel={(e) => e.stopPropagation()}
        >
          {floatingData.type === 'task' ? (
            <TaskDetailPanel
              task={localTask || floatingData.item as Task}
              propertyName={floatingData.propertyName}
              currentUser={currentUser}
              taskTemplates={taskTemplates}
              loadingTaskTemplate={loadingTaskTemplate}
              onClose={handleCloseFloatingWindow}
              onUpdateStatus={handleUpdateTaskStatus}
              onSaveForm={handleSaveTaskForm}
              setTask={setLocalTask}
              onShowTurnover={handleShowTurnover}
            />
          ) : floatingData.type === 'project' && projectFields ? (
            <ProjectDetailPanel
              project={floatingData.item as Project}
              users={users}
              editingFields={projectFields}
              setEditingFields={setProjectFields}
              savingEdit={projectsHook.savingProjectEdit}
              onSave={handleSaveProject}
              onDelete={handleDeleteProject}
              onClose={handleCloseFloatingWindow}
              onOpenActivity={handleOpenActivity}
              // Comments
              comments={commentsHook.projectComments}
              loadingComments={commentsHook.loadingComments}
              newComment={newComment}
              setNewComment={setNewComment}
              postingComment={commentsHook.postingComment}
              onPostComment={handlePostComment}
              // Attachments
              attachments={attachmentsHook.projectAttachments}
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
          ) : floatingData.type === 'turnover' ? (
            /* Turnover Detail Panel */
            <div className="flex flex-col h-full">
              {/* Sticky Header - Property Info + Toggle */}
              <div className="sticky top-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700">
                {/* Top Row: Property name, Guest, Dates, Occupancy, Close button */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    {/* Property & Guest */}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold truncate">{(floatingData.item as Turnover).property_name}</h2>
                      {(floatingData.item as Turnover).guest_name && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-neutral-500">
                          <svg className="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span className="truncate">{(floatingData.item as Turnover).guest_name}</span>
                        </div>
                      )}
                    </div>

                    {/* Dates & Occupancy - Compact */}
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">In</div>
                        <div className="font-medium text-blue-600 dark:text-blue-400">
                          {(floatingData.item as Turnover).check_in ? new Date((floatingData.item as Turnover).check_in!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Out</div>
                        <div className="font-medium text-red-600 dark:text-red-400">
                          {(floatingData.item as Turnover).check_out ? new Date((floatingData.item as Turnover).check_out!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Next In</div>
                        <div className="font-medium text-green-600 dark:text-green-400">
                          {(floatingData.item as Turnover).next_check_in ? new Date((floatingData.item as Turnover).next_check_in!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                    </div>

                    {/* Close Button */}
                    <button
                      onClick={handleCloseFloatingWindow}
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
                        setTurnoverRightPanelView('tasks');
                        setExpandedProjectInTurnover(null);
                        setTurnoverProjectFields(null);
                      }}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        turnoverRightPanelView === 'tasks'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      Turnover Tasks ({(floatingData.item as Turnover).completed_tasks || 0}/{(floatingData.item as Turnover).total_tasks || 0})
                    </button>
                    <button
                      onClick={() => setTurnoverRightPanelView('projects')}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        turnoverRightPanelView === 'projects'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      Property Projects ({projects.filter(p => p.property_name === (floatingData.item as Turnover).property_name).length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className={`flex-1 overflow-y-auto hide-scrollbar ${turnoverRightPanelView === 'tasks' ? 'p-4 space-y-3' : ''}`}>
                {turnoverRightPanelView === 'tasks' ? (
                  <TurnoverTaskList
                    selectedCard={floatingData.item as Turnover}
                    users={users}
                    taskTemplates={taskTemplates as Record<string, Template>}
                    availableTemplates={availableTemplates}
                    showAddTaskDialog={showAddTaskDialog}
                    setShowAddTaskDialog={setShowAddTaskDialog}
                    onTaskClick={handleTurnoverTaskClick}
                    onDeleteTask={deleteTaskFromTurnover}
                    onUpdateSchedule={updateTurnoverTaskSchedule}
                    onUpdateAssignment={updateTurnoverTaskAssignment}
                    onAddTask={addTaskToTurnover}
                    onFetchTemplates={fetchAvailableTemplates}
                    fetchTaskTemplate={fetchTaskTemplate}
                  />
                ) : (
                  <TurnoverProjectsPanel
                    propertyName={(floatingData.item as Turnover).property_name}
                    projects={projects}
                    users={users}
                    currentUser={currentUser}
                    expandedProject={expandedProjectInTurnover}
                    projectFields={turnoverProjectFields}
                    savingProject={projectsHook.savingProjectEdit}
                    staffOpen={turnoverStaffOpen}
                    setExpandedProject={setExpandedProjectInTurnover}
                    setProjectFields={setTurnoverProjectFields}
                    setStaffOpen={setTurnoverStaffOpen}
                    onSaveProject={handleTurnoverSaveProject}
                    onDeleteProject={handleTurnoverDeleteProject}
                    onOpenProjectInWindow={() => {}}
                    onCreateProject={handleTurnoverCreateProject}
                    projectComments={turnoverCommentsHook.projectComments}
                    loadingComments={turnoverCommentsHook.loadingComments}
                    newComment={turnoverNewComment}
                    setNewComment={setTurnoverNewComment}
                    postingComment={turnoverCommentsHook.postingComment}
                    onPostComment={handleTurnoverPostComment}
                    projectAttachments={turnoverAttachmentsHook.projectAttachments}
                    loadingAttachments={turnoverAttachmentsHook.loadingAttachments}
                    uploadingAttachment={turnoverAttachmentsHook.uploadingAttachment}
                    attachmentInputRef={turnoverAttachmentsHook.attachmentInputRef}
                    onAttachmentUpload={handleTurnoverAttachmentUpload}
                    onViewAttachment={setTurnoverViewingAttachmentIndex}
                    activeTimeEntry={turnoverTimeTrackingHook.activeTimeEntry}
                    displaySeconds={turnoverTimeTrackingHook.displaySeconds}
                    formatTime={turnoverTimeTrackingHook.formatTime}
                    onStartTimer={handleTurnoverStartTimer}
                    onStopTimer={turnoverTimeTrackingHook.stopProjectTimer}
                    onOpenActivity={handleTurnoverOpenActivity}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-neutral-500">Loading...</p>
            </div>
          )}
        </div>
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

      {/* Turnover Projects - Attachment Lightbox */}
      <AttachmentLightbox
        attachments={turnoverAttachmentsHook.projectAttachments}
        viewingIndex={turnoverViewingAttachmentIndex}
        onClose={() => setTurnoverViewingAttachmentIndex(null)}
        onNavigate={setTurnoverViewingAttachmentIndex}
      />

      {/* Turnover Projects - Activity Sheet */}
      <ProjectActivitySheet
        open={turnoverActivitySheetOpen}
        onOpenChange={setTurnoverActivitySheetOpen}
        activities={turnoverActivityHook.projectActivity}
        loading={turnoverActivityHook.loadingActivity}
      />

    </div>
  );
}
