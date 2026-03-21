'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty } from '@/lib/turnoverUtils';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import { ScheduledItemsCell, DayKanban } from './timeline';
import { AttachmentLightbox, ProjectActivitySheet, ProjectDetailPanel } from './projects';
import { TaskDetailPanel, TurnoverTaskList, TurnoverProjectsPanel } from './turnovers';
import DiamondIcon from '@/components/icons/AssignmentIcon';
import HexagonIcon from '@/components/icons/HammerIcon';
import Rhombus16FilledIcon from '@/components/icons/Rhombus16FilledIcon';
import RectangleStackIcon from '@/components/icons/RectangleStackIcon';
import type { Project, Task, User, ProjectFormFields, Turnover, TaskTemplate } from '@/lib/types';
import type { useProjects } from '@/lib/useProjects';
import type { Template } from '@/components/DynamicCleaningForm';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/user-avatar';

// Status-colored row styles — matches hover dropdown / TaskDetailPanel / TurnoverTaskList
const getRowStyles = (status: string) => {
  const base = 'glass-card glass-sheen relative overflow-hidden rounded-lg';
  switch (status) {
    case 'complete':
      return `${base} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`;
    case 'in_progress':
    case 'paused':
      return `${base} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'contingent':
      return `${base} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`;
    case 'on_hold':
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
    default:
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
  }
};

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
    recurringTasks,
    setRecurringTasks,
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

  // Expanded property rows in timeline grid
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const togglePropertyExpanded = useCallback((property: string) => {
    setExpandedProperties(prev => {
      const next = new Set(prev);
      if (next.has(property)) {
        next.delete(property);
      } else {
        next.add(property);
      }
      return next;
    });
  }, []);
  const toggleAllExpanded = useCallback(() => {
    setExpandedProperties(prev => {
      if (prev.size === properties.length) return new Set();
      return new Set(properties);
    });
  }, [properties]);
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
        department_id: project.department_id || '',
        scheduled_date: project.scheduled_date || '',
        scheduled_time: project.scheduled_time || ''
      });
      commentsHook.fetchProjectComments(project.id);
      attachmentsHook.fetchProjectAttachments(project.id);
      timeTrackingHook.fetchProjectTimeEntries(project.id);
    } else if (floatingData?.type === 'task') {
      const task = floatingData.item as Task;
      setLocalTask(task);
      // Fetch template if needed (with property context for overrides)
      const propName = floatingData.propertyName || task.property_name;
      const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
      if (task.template_id && !taskTemplates[cacheKey!]) {
        fetchTaskTemplate(task.template_id, propName);
      }
    } else {
      setProjectFields(null);
      setLocalTask(null);
    }
  }, [floatingData?.type, floatingItemId]);

  // ============================================================================
  // Task functions
  // ============================================================================
  const fetchTaskTemplate = useCallback(async (templateId: string, propertyName?: string) => {
    const cacheKey = propertyName ? `${templateId}__${propertyName}` : templateId;

    if (taskTemplates[cacheKey]) {
      return taskTemplates[cacheKey];
    }

    setLoadingTaskTemplate(templateId);
    try {
      const url = propertyName
        ? `/api/templates/${templateId}?property_name=${encodeURIComponent(propertyName)}`
        : `/api/templates/${templateId}`;
      const res = await fetch(url);
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to fetch template');
      }

      setTaskTemplates(prev => ({ ...prev, [cacheKey]: result.template }));
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

      // Update local task state (for the currently open panel)
      setLocalTask(prev => prev ? { ...prev, status: action as Task['status'] } : null);

      // Persist status into turnover/occupancy/vacancy tasks nested inside reservations
      setReservations((prev: any[]) => prev.map((r: any) => ({
        ...r,
        tasks: (r.tasks || []).map((t: any) =>
          t.task_id === taskId ? { ...t, status: action } : t
        ),
      })));

      // Persist status into recurring tasks
      setRecurringTasks((prev: any[]) => prev.map((t: any) =>
        t.task_id === taskId ? { ...t, status: action } : t
      ));
    } catch (err) {
      console.error('Error updating task status:', err);
    }
  }, [setReservations, setRecurringTasks]);

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

      // Update localTask if it's the same task
      setLocalTask(prev => {
        if (!prev || prev.task_id !== taskId) return prev;
        return { ...prev, assigned_users: assignedUsers };
      });

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

  const updateTurnoverTaskSchedule = useCallback(async (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => {
    try {
      const res = await fetch('/api/update-task-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, scheduledDate, scheduledTime })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update task schedule');

      // Update task in reservations
      setReservations(prev => prev.map(reservation => ({
        ...reservation,
        tasks: (reservation.tasks || []).map((task: Task) => 
          task.task_id === taskId ? { ...task, scheduled_date: scheduledDate, scheduled_time: scheduledTime } : task
        )
      })));

      // Update localTask if it's the same task
      setLocalTask(prev => {
        if (!prev || prev.task_id !== taskId) return prev;
        return { ...prev, scheduled_date: scheduledDate, scheduled_time: scheduledTime };
      });

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
                task.task_id === taskId ? { ...task, scheduled_date: scheduledDate, scheduled_time: scheduledTime } : task
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
    const propName = floatingData?.propertyName || task.property_name;
    const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
    if (task.template_id && !taskTemplates[cacheKey!]) {
      fetchTaskTemplate(task.template_id, propName);
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
        department_id: expandedProjectInTurnover.department_id || '',
        scheduled_date: expandedProjectInTurnover.scheduled_date || '',
        scheduled_time: expandedProjectInTurnover.scheduled_time || ''
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

  // Handle column moves from kanban drag/drop (assignment + schedule changes, atomically)
  const handleKanbanColumnMove = useCallback(async (
    itemType: 'task' | 'project',
    itemId: string,
    changes: {
      assigneeId?: string | null;
      scheduledDate?: string | null;
      scheduledTime?: string | null;
    }
  ) => {
    try {
      if (itemType === 'task') {
        // Fire applicable API calls in parallel
        const apiCalls: Promise<Response>[] = [];

        if (changes.assigneeId !== undefined) {
          apiCalls.push(
            fetch('/api/update-task-assignment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: itemId,
                userIds: changes.assigneeId ? [changes.assigneeId] : []
              })
            })
          );
        }

        if (changes.scheduledDate !== undefined) {
          apiCalls.push(
            fetch('/api/update-task-schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: itemId,
                scheduledDate: changes.scheduledDate,
                scheduledTime: changes.scheduledTime !== undefined ? changes.scheduledTime : undefined
              })
            })
          );
        }

        const results = await Promise.all(apiCalls);
        for (const res of results) {
          if (!res.ok) {
            const result = await res.json();
            throw new Error(result.error || 'Failed to update task');
          }
        }

        // Single atomic state update for tasks in reservations
        const assignedUser = changes.assigneeId
          ? users.find((u: any) => u.id === changes.assigneeId)
          : null;

        setReservations(prev => prev.map(reservation => ({
          ...reservation,
          tasks: (reservation.tasks || []).map((task: Task) => {
            if (task.task_id !== itemId) return task;
            const updated = { ...task };
            if (changes.scheduledDate !== undefined) {
              updated.scheduled_date = changes.scheduledDate;
            }
            if (changes.scheduledTime !== undefined) {
              updated.scheduled_time = changes.scheduledTime;
            }
            if (changes.assigneeId !== undefined) {
              updated.assigned_users = changes.assigneeId
                ? [{
                    user_id: changes.assigneeId,
                    name: assignedUser?.name || '',
                    avatar: assignedUser?.avatar || '',
                    role: assignedUser?.role || ''
                  }]
                : [];
            }
            return updated;
          })
        })));

        // Also update recurring tasks
        setRecurringTasks((prev: any[]) => prev.map((t: any) => {
          if (t.task_id !== itemId) return t;
          const updated = { ...t };
          if (changes.scheduledDate !== undefined) {
            updated.scheduled_date = changes.scheduledDate;
          }
          if (changes.scheduledTime !== undefined) {
            updated.scheduled_time = changes.scheduledTime;
          }
          if (changes.assigneeId !== undefined) {
            updated.assigned_users = changes.assigneeId
              ? [{
                  user_id: changes.assigneeId,
                  name: assignedUser?.name || '',
                  avatar: assignedUser?.avatar || '',
                  role: assignedUser?.role || ''
                }]
              : [];
          }
          return updated;
        }));

      } else {
        // Project: build update payload with whatever changed
        const projectPayload: Record<string, any> = {
          user_id: currentUser?.id
        };
        if (changes.assigneeId !== undefined) {
          projectPayload.assigned_user_ids = changes.assigneeId ? [changes.assigneeId] : [];
        }
        if (changes.scheduledDate !== undefined) {
          projectPayload.scheduled_date = changes.scheduledDate;
        }
        if (changes.scheduledTime !== undefined) {
          projectPayload.scheduled_time = changes.scheduledTime;
        }

        const res = await fetch(`/api/projects/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projectPayload)
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || 'Failed to update project');
        }

        if (result.data) {
          projectsHook.setProjects(prev =>
            prev.map(p => p.id === itemId ? result.data : p)
          );
        }
      }
    } catch (err) {
      console.error('Error updating column move:', err);
    }
  }, [currentUser?.id, projectsHook, setReservations, setRecurringTasks, users]);

  // Extract ALL tasks from reservations + recurring tasks, tagged with property_name
  const allTasksWithProperty = useMemo(() => {
    const tasks: (Task & { property_name: string })[] = [];
    // Tasks from reservations (turnover, occupancy, vacancy triggers)
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        tasks.push({ ...task, property_name: res.property_name });
      });
    });
    // Recurring tasks (property-level, no reservation)
    recurringTasks.forEach((task: any) => {
      tasks.push({ ...task, property_name: task.property_name });
    });
    return tasks;
  }, [reservations, recurringTasks]);

  // Extract tasks with scheduled_date (for kanban user columns)
  const allScheduledTasks = useMemo(() => {
    return allTasksWithProperty.filter(task => task.scheduled_date);
  }, [allTasksWithProperty]);

  // Filter projects that have scheduled_date
  const scheduledProjects = useMemo(() => {
    return projects.filter(p => p.scheduled_date);
  }, [projects]);

  const formatHeaderDate = (date: Date, isTodayDate: boolean) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return (
      <div className="text-center">
        <div className={`text-[11px] ${isTodayDate ? 'text-neutral-800 dark:text-neutral-200' : 'text-neutral-600 dark:text-neutral-400'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-xs ${isTodayDate ? 'text-neutral-900 dark:text-white font-semibold' : 'text-neutral-900 dark:text-white'}`}>
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
      <div className="flex-shrink-0 px-4 py-3 glass-panel bg-white/40 dark:bg-white/[0.05] border-b border-white/20 dark:border-white/10">
        <div className="flex items-center gap-4 mb-2">
          {/* View Mode Icons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm' 
                  : 'text-neutral-500 hover:bg-white/30 dark:hover:bg-white/10 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
              title="Grid View"
            >
              <Rhombus16FilledIcon size={18} />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'kanban' 
                  ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm' 
                  : 'text-neutral-500 hover:bg-white/30 dark:hover:bg-white/10 hover:text-neutral-700 dark:hover:text-neutral-300'
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
            className="grid border border-white/30 dark:border-white/10 w-full"
            style={{
              gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-white/50 dark:bg-white/[0.08] backdrop-blur-xl px-2 py-1 text-xs font-semibold text-neutral-900 dark:text-white sticky left-0 top-0 z-20 flex items-center gap-1.5">
              <button
                onClick={toggleAllExpanded}
                className="p-0.5 rounded hover:bg-white/30 dark:hover:bg-white/10 transition-colors"
                title={expandedProperties.size === properties.length ? 'Collapse all' : 'Expand all'}
              >
                <svg className={`w-3 h-3 transition-transform duration-200 ${expandedProperties.size === properties.length ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              Property
            </div>
            {dateRange.map((date, idx) => {
              const isTodayDate = isToday(date);
              return (
                <div 
                  key={idx} 
                  className={`px-1 py-1 border-b border-r border-white/20 dark:border-white/10 sticky top-0 z-10 cursor-pointer transition-colors ${
                    isTodayDate 
                      ? 'bg-neutral-500/20 dark:bg-white/[0.10] hover:bg-neutral-500/30 dark:hover:bg-white/[0.14] backdrop-blur-sm' 
                      : 'bg-white/40 dark:bg-white/[0.06] hover:bg-white/55 dark:hover:bg-white/[0.10] backdrop-blur-sm'
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

              // Cell background tint matching active turnover card colors
              const propertyCellBg = activeTurnover
                ? (() => {
                    switch (activeTurnover.turnover_status) {
                      case 'not_started':
                        // Rose gold — warm peachy-gold
                        return 'bg-amber-50/55 dark:bg-amber-400/[0.12]';
                      case 'in_progress':
                        // Midnight blue
                        return 'bg-indigo-50/55 dark:bg-indigo-500/[0.12]';
                      case 'complete':
                        // Emerald green
                        return 'bg-emerald-50/55 dark:bg-emerald-500/[0.12]';
                      case 'no_tasks':
                        return 'bg-white/55 dark:bg-white/[0.08]';
                      default:
                        return 'bg-white/45 dark:bg-white/[0.06]';
                    }
                  })()
                : 'bg-white/45 dark:bg-white/[0.06]';

              return (
                <div
                  key={property}
                  className="contents"
                >
                  {/* Property Name with Status Indicator */}
                  <div className={`glass-card glass-sheen relative overflow-hidden px-2 py-1 text-xs font-medium text-neutral-900 dark:text-white sticky left-0 z-10 ${propertyCellBg} flex items-center gap-1.5`}>
                    <button
                      onClick={() => togglePropertyExpanded(property)}
                      className="p-0.5 rounded hover:bg-white/30 dark:hover:bg-white/10 transition-colors shrink-0"
                    >
                      <svg className={`w-3 h-3 transition-transform duration-200 ${expandedProperties.has(property) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <span className="truncate pr-24">{property}</span>
                    {activeTurnover && (() => {
                      const propertyProjects = projects.filter(p => p.property_name === activeTurnover.property_name);
                      
                      return (
                        <Popover>
                          <PopoverTrigger asChild>
                            <div className="absolute right-0 top-0 bottom-0 w-28 flex items-center justify-end pr-2 cursor-pointer">
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/10 dark:bg-black/40 text-neutral-500 dark:text-neutral-400 hover:bg-black/15 dark:hover:bg-black/50 transition-colors">
                                {/* Tasks icon + count */}
                                <div className="flex items-center gap-0.5">
                                  <DiamondIcon size={12} />
                                  <span className="text-[10px] font-medium w-3 text-right">
                                    {activeTurnover.tasks?.filter(t => t.status !== 'complete').length || 0}
                                  </span>
                                </div>
                                {/* Projects icon + count */}
                                <div className="flex items-center gap-0.5">
                                  <HexagonIcon size={12} />
                                  <span className="text-[10px] font-medium w-3 text-right">
                                    {propertyProjects.filter(p => p.status !== 'complete').length}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </PopoverTrigger>
                          <PopoverContent side="right" align="start" sideOffset={4} collisionPadding={16} className="w-72 p-0 glass-card bg-white/90 dark:bg-neutral-900/95 border-white/30 dark:border-white/10">
                            {/* Header with close button */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-white/20 dark:border-white/10">
                              <p className="text-sm font-medium">{property}</p>
                              <PopoverClose className="p-1 hover:bg-white/20 dark:hover:bg-white/10 rounded-md transition-colors text-neutral-500 dark:text-neutral-400">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </PopoverClose>
                            </div>
                            
                            {/* Tasks Section */}
                            <div className="px-2 py-2 border-b border-white/20 dark:border-white/10">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                                Active Turnover: ({activeTurnover.completed_tasks || 0}/{activeTurnover.total_tasks || 0})
                              </p>
                              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto subtle-scrollbar">
                                {activeTurnover.tasks && activeTurnover.tasks.length > 0 ? (
                                  activeTurnover.tasks.map((task) => {
                                    const rowBase = 'glass-card glass-sheen relative overflow-hidden rounded-lg';
                                    const rowStyle = task.status === 'complete'
                                      ? `${rowBase} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`
                                      : task.status === 'in_progress' || task.status === 'paused'
                                      ? `${rowBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`
                                      : task.status === 'contingent'
                                      ? `${rowBase} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`
                                      : `${rowBase} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
                                    return (
                                      <div 
                                        key={task.task_id} 
                                        className={`flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] ${rowStyle}`}
                                        onClick={() => setFloatingData({
                                          type: 'task',
                                          item: task,
                                          propertyName: activeTurnover.property_name,
                                        })}
                                      >
                                        <span className="truncate text-sm">{task.template_name || task.type}</span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-sm text-muted-foreground px-1">No tasks</p>
                                )}
                              </div>
                            </div>
                            
                            {/* Projects Section */}
                            <div className="px-2 py-2">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                                Projects ({propertyProjects.length})
                              </p>
                              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto subtle-scrollbar">
                                {propertyProjects.length > 0 ? (
                                  propertyProjects.map((project) => {
                                    const rowBase = 'glass-card glass-sheen relative overflow-hidden rounded-lg';
                                    const rowStyle = project.status === 'complete'
                                      ? `${rowBase} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`
                                      : project.status === 'in_progress'
                                      ? `${rowBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`
                                      : `${rowBase} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
                                    return (
                                      <div 
                                        key={project.id} 
                                        className={`flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] ${rowStyle}`}
                                        onClick={() => setFloatingData({
                                          type: 'project',
                                          item: project,
                                          propertyName: activeTurnover.property_name,
                                        })}
                                      >
                                        <span className="truncate text-sm">{project.title}</span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-sm text-muted-foreground px-1">No projects</p>
                                )}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
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
                        className={`border-b border-r border-white/20 dark:border-white/10 h-[30px] relative overflow-visible ${isTodayDate ? 'bg-neutral-500/10 dark:bg-white/[0.05]' : 'bg-white/30 dark:bg-white/[0.02]'}`}
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
                              className={`absolute cursor-pointer transition-all duration-150 hover:brightness-110 hover:z-30 text-neutral-800 dark:text-white text-[11px] font-medium flex items-center glass-card glass-sheen overflow-hidden bg-neutral-400/35 dark:bg-white/[0.10] border border-white/40 dark:border-white/[0.12] hover:bg-neutral-400/45 dark:hover:bg-white/[0.15] ${selectedReservation?.id === startingReservation.id ? 'ring-2 ring-white/70 dark:ring-white shadow-lg z-30' : ''}`}
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
                          expanded={expandedProperties.has(property)}
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

                  {/* Expanded Detail Row */}
                  {expandedProperties.has(property) && (
                    <>
                      {/* Property column for expanded row — empty */}
                      <div className={`sticky left-0 z-10 border-b border-white/20 dark:border-white/10 ${propertyCellBg} backdrop-blur-sm`} />

                      {/* Date columns for expanded row */}
                      {dateRange.map((date, idx) => {
                        const isTodayDate = isToday(date);
                        const cellDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        const dateTasks = allScheduledTasks.filter(
                          (t) => t.property_name === property && t.scheduled_date === cellDateStr
                        );
                        const dateProjects = scheduledProjects.filter(
                          (p) => p.property_name === property && p.scheduled_date === cellDateStr
                        );
                        const hasItems = dateTasks.length > 0 || dateProjects.length > 0;

                        return (
                          <div
                            key={`expanded-${idx}`}
                            className={`border-b border-r border-white/20 dark:border-white/10 p-1.5 ${
                              isTodayDate ? 'bg-neutral-500/10 dark:bg-white/[0.05]' : 'bg-white/20 dark:bg-white/[0.01]'
                            }`}
                          >
                            {hasItems && (
                              <div className="flex flex-col gap-2">
                                {dateTasks.map((task) => (
                                  <div
                                    key={task.task_id}
                                    className={cn(
                                      "flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99]",
                                      getRowStyles(task.status)
                                    )}
                                    title={task.template_name || task.type}
                                    onClick={() => setFloatingData({
                                      type: 'task',
                                      item: task,
                                      propertyName: property,
                                    })}
                                  >
                                    <span className="truncate text-sm">{task.template_name || task.type}</span>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {task.assigned_users?.slice(0, 1).map((user) => (
                                        <UserAvatar
                                          key={user.user_id}
                                          src={user.avatar}
                                          name={user.name || 'Unknown'}
                                          size="xs"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {dateProjects.map((project) => (
                                  <div
                                    key={project.id}
                                    className={cn(
                                      "flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99]",
                                      getRowStyles(project.status)
                                    )}
                                    title={project.title}
                                    onClick={() => setFloatingData({
                                      type: 'project',
                                      item: project,
                                      propertyName: property,
                                    })}
                                  >
                                    <span className="truncate text-sm">{project.title}</span>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {project.project_assignments?.slice(0, 1).map((assignment) => (
                                        <UserAvatar
                                          key={assignment.user_id}
                                          src={assignment.user?.avatar}
                                          name={assignment.user?.name || 'Unknown'}
                                          size="xs"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
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
            onColumnMove={handleKanbanColumnMove}
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
          className="absolute top-0 right-0 h-full w-[30%] min-w-[320px] bg-white/30 dark:bg-white/[0.03] backdrop-blur-xl border-l border-white/20 dark:border-white/10 shadow-xl z-30 overflow-y-auto"
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
              onShowTurnover={
                (localTask || floatingData.item as any)?.is_recurring
                  ? undefined
                  : handleShowTurnover
              }
              users={users}
              onUpdateSchedule={updateTurnoverTaskSchedule}
              onUpdateAssignment={updateTurnoverTaskAssignment}
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
              <div className="sticky top-0 bg-white/40 dark:bg-white/[0.04] backdrop-blur-2xl z-10 border-b border-white/20 dark:border-white/10">
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
                  <div className="flex rounded-xl bg-white/20 dark:bg-white/[0.05] backdrop-blur-sm border border-white/20 dark:border-white/10 p-1">
                    <button
                      onClick={() => {
                        setTurnoverRightPanelView('tasks');
                        setExpandedProjectInTurnover(null);
                        setTurnoverProjectFields(null);
                      }}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                        turnoverRightPanelView === 'tasks'
                          ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/20 dark:hover:bg-white/10'
                      }`}
                    >
                      Turnover Tasks ({(floatingData.item as Turnover).completed_tasks || 0}/{(floatingData.item as Turnover).total_tasks || 0})
                    </button>
                    <button
                      onClick={() => setTurnoverRightPanelView('projects')}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                        turnoverRightPanelView === 'projects'
                          ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/20 dark:hover:bg-white/10'
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
