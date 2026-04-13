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
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { ScheduledItemsCell, DayKanban } from './timeline';
import { AttachmentLightbox, ProjectActivitySheet, ProjectDetailPanel } from './projects';
import { TurnoverTaskList, TurnoverProjectsPanel } from './turnovers';
import { ClipboardCheck } from 'lucide-react';
import Rhombus16FilledIcon from '@/components/icons/Rhombus16FilledIcon';
import RectangleStackIcon from '@/components/icons/RectangleStackIcon';
import type { Project, Task, User, ProjectFormFields, Turnover, TaskTemplate, PropertyOption } from '@/lib/types';
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
      return `${base} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'paused':
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
    case 'contingent':
      return `${base} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`;
    default:
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
  }
};

interface TimelineWindowProps {
  users: User[];
  currentUser: User | null;
}

// Type for what's being viewed in the floating window
type FloatingWindowData = {
  type: 'task' | 'project' | 'turnover';
  item: Task | Project | Turnover;
  propertyName: string;
} | null;

export default function TimelineWindow({
  users,
  currentUser,
}: TimelineWindowProps) {
  // State for the floating window
  const [floatingData, setFloatingData] = useState<FloatingWindowData>(null);
  
  // State for view mode (grid vs kanban)
  const [viewMode, setViewMode] = useState<'grid' | 'kanban'>('grid');
  
  // State for kanban - use current date as default when in kanban view mode
  const [kanbanDate, setKanbanDate] = useState<Date>(new Date());

  // ============================================================================
  // LOCAL project data (fetched from tasks-for-bin API)
  // ============================================================================
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const params = new URLSearchParams({ bin_id: '__all__' });
      if (currentUser?.id) params.set('viewer_user_id', currentUser.id);
      const res = await fetch(`/api/tasks-for-bin?${params.toString()}`);
      const result = await res.json();
      if (res.ok && result.data) setProjects(result.data);
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  }, [currentUser?.id]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    fetch('/api/properties')
      .then(r => r.json())
      .then(result => { if (result.properties) setAllProperties(result.properties); })
      .catch(err => console.error('Error fetching properties:', err));
  }, []);

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
    fetchReservations,
  } = useTimeline();

  // ============================================================================
  // LOCAL instances of sub-hooks for projects (independent from other windows)
  // ============================================================================
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const activityHook = useProjectActivity();
  const binsHook = useProjectBins({ currentUser });

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
  const [taskEditingFields, setTaskEditingFields] = useState<ProjectFormFields | null>(null);
  const [taskStaffOpen, setTaskStaffOpen] = useState(false);
  const taskEditingFieldsRef = useRef<ProjectFormFields | null>(null);
  const taskAttachmentRef = useRef<HTMLInputElement>(null);
  const [taskNewComment, setTaskNewComment] = useState('');
  const [taskViewingAttachmentIndex, setTaskViewingAttachmentIndex] = useState<number | null>(null);

  const taskCommentsHook = useProjectComments({ currentUser });
  const taskAttachmentsHook = useProjectAttachments({ currentUser });
  const taskTimeTrackingHook = useProjectTimeTracking({ currentUser });

  useEffect(() => {
    taskEditingFieldsRef.current = taskEditingFields;
  }, [taskEditingFields]);


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
        description: project.description || null,
        status: project.status,
        priority: project.priority,
        assigned_staff: project.project_assignments?.map(a => a.user_id) || [],
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
      setTaskEditingFields({
        title: task.title || task.template_name || 'Task',
        description: task.description || null,
        status: task.status,
        priority: task.priority || 'medium',
        assigned_staff: (task.assigned_users || []).map(u => u.user_id),
        department_id: task.department_id || '',
        scheduled_date: task.scheduled_date || '',
        scheduled_time: task.scheduled_time || '',
      });
      // Fetch template if needed (with property context for overrides)
      const propName = floatingData.propertyName || task.property_name;
      const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
      if (task.template_id && !taskTemplates[cacheKey!]) {
        fetchTaskTemplate(task.template_id, propName);
      }
      // Fetch comments, attachments, time entries for this task
      taskCommentsHook.fetchProjectComments(task.task_id, 'task');
      taskAttachmentsHook.fetchProjectAttachments(task.task_id, 'task');
      taskTimeTrackingHook.fetchProjectTimeEntries(task.task_id, 'task');
      // Ensure available templates are loaded for the picker
      if (availableTemplates.length === 0) fetchAvailableTemplates();
    } else {
      setProjectFields(null);
      setLocalTask(null);
      setTaskEditingFields(null);
      setTaskStaffOpen(false);
      setTaskNewComment('');
      taskCommentsHook.clearComments();
      taskAttachmentsHook.clearAttachments();
      taskTimeTrackingHook.clearTimeTracking();
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
  const handleSaveProject = useCallback(async (directFields?: ProjectFormFields) => {
    const currentFields = directFields || projectFieldsRef.current;
    if (floatingData?.type !== 'project' || !currentFields) return;
    const project = floatingData.item as Project;
    setSavingProjectEdit(true);
    try {
      const res = await fetch(`/api/tasks-for-bin/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentFields.title,
          description: currentFields.description || null,
          status: currentFields.status,
          priority: currentFields.priority,
          assigned_user_ids: currentFields.assigned_staff || [],
          department_id: currentFields.department_id || null,
          scheduled_date: currentFields.scheduled_date || null,
          scheduled_time: currentFields.scheduled_time || null,
        }),
      });
      const data = await res.json();
      if (data.data) {
        const d = data.data;
        setProjects(prev => prev.map(p => p.id === project.id ? d : p));
        setFloatingData(prev => prev ? { ...prev, item: d } : null);
        setProjectFields({
          title: d.title,
          description: d.description || null,
          status: d.status,
          priority: d.priority,
          assigned_staff: d.project_assignments?.map((a: { user_id: string }) => a.user_id) || currentFields.assigned_staff || [],
          department_id: d.department_id || '',
          scheduled_date: d.scheduled_date || '',
          scheduled_time: d.scheduled_time || '',
        });
      }
    } catch (err) {
      console.error('Error saving project:', err);
    } finally {
      setSavingProjectEdit(false);
    }
  }, [floatingData]);

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

  const handleDeleteProject = useCallback(async (project: Project) => {
    if (!confirm(`Delete project "${project.title}"?`)) return;
    try {
      const res = await fetch(`/api/tasks-for-bin/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== project.id));
        setFloatingData(null);
        setProjectFields(null);
      }
    } catch (err) {
      console.error('Error deleting project:', err);
    }
  }, []);

  const handleOpenActivity = useCallback(() => {
    if (floatingData?.type === 'project') {
      const project = floatingData.item as Project;
      activityHook.fetchProjectActivity(project.id);
      setActivitySheetOpen(true);
    }
  }, [floatingData, activityHook]);

  // ============================================================================
  // Task → ProjectDetailPanel: save handler + derived data
  // ============================================================================
  const handleSaveTaskEditFields = useCallback(async (directFields?: ProjectFormFields) => {
    if (!localTask) return;
    const fields = directFields || taskEditingFieldsRef.current;
    if (!fields) return;
    const taskId = localTask.task_id;

    if (fields.status !== localTask.status) {
      handleUpdateTaskStatus(taskId, fields.status);
      setLocalTask((prev: Task | null) => prev ? { ...prev, status: fields.status as Task['status'] } : null);
    }

    const oldDate = localTask.scheduled_date || '';
    const oldTime = localTask.scheduled_time || '';
    if (fields.scheduled_date !== oldDate || fields.scheduled_time !== oldTime) {
      updateTurnoverTaskSchedule(taskId, fields.scheduled_date || null, fields.scheduled_time || null);
    }

    const oldAssignees = (localTask.assigned_users || []).map(u => u.user_id).sort().join(',');
    const newAssignees = (fields.assigned_staff || []).sort().join(',');
    if (oldAssignees !== newAssignees) {
      updateTurnoverTaskAssignment(taskId, fields.assigned_staff || []);
    }

    const fieldUpdates: Record<string, unknown> = {};
    const origTitle = localTask.title || localTask.template_name || 'Task';
    const origPriority = localTask.priority || 'medium';
    if (fields.title !== origTitle) fieldUpdates.title = fields.title;
    if (JSON.stringify(fields.description) !== JSON.stringify(localTask.description || null)) fieldUpdates.description = fields.description;
    if (fields.priority !== origPriority) fieldUpdates.priority = fields.priority;
    if (fields.department_id !== (localTask.department_id || '')) fieldUpdates.department_id = fields.department_id || null;

    if (Object.keys(fieldUpdates).length > 0) {
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields: fieldUpdates }),
        });
      } catch (err) {
        console.error('Error updating task fields:', err);
      }
    }

    if (directFields) {
      setTaskEditingFields(directFields);
    }
  }, [localTask, handleUpdateTaskStatus, updateTurnoverTaskSchedule, updateTurnoverTaskAssignment]);

  const taskAsProject: Project | null = localTask ? {
    id: localTask.task_id,
    property_name: floatingData?.propertyName || localTask.property_name || null,
    bin_id: localTask.bin_id || null,
    template_id: localTask.template_id || null,
    template_name: localTask.template_name || null,
    title: localTask.title || localTask.template_name || 'Task',
    description: localTask.description || null,
    status: localTask.status as Project['status'],
    priority: (localTask.priority || 'medium') as Project['priority'],
    department_id: localTask.department_id || null,
    department_name: localTask.department_name || null,
    scheduled_date: localTask.scheduled_date || null,
    scheduled_time: localTask.scheduled_time || null,
    form_metadata: localTask.form_metadata || undefined,
    project_assignments: (localTask.assigned_users || []).map(u => ({
      user_id: u.user_id,
      user: { id: u.user_id, name: u.name, avatar: u.avatar, role: u.role }
    })),
    created_at: '',
    updated_at: '',
  } : null;

  const resolvedTaskTemplate = localTask?.template_id
    ? (taskTemplates[`${localTask.template_id}__${floatingData?.propertyName}`] as Template
       || taskTemplates[localTask.template_id] as Template)
    : null;

  const formatTimeDisplay = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, []);

  const handleCloseFloatingWindow = useCallback(() => {
    setFloatingData(null);
    setProjectFields(null);
    setLocalTask(null);
    setTaskEditingFields(null);
    setTaskStaffOpen(false);
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
        description: expandedProjectInTurnover.description || null,
        status: expandedProjectInTurnover.status,
        priority: expandedProjectInTurnover.priority,
        assigned_staff: expandedProjectInTurnover.project_assignments?.map(a => a.user_id) || [],
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
    setSavingProjectEdit(true);
    try {
      const res = await fetch(`/api/tasks-for-bin/${expandedProjectInTurnover.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentFields.title,
          description: currentFields.description || null,
          status: currentFields.status,
          priority: currentFields.priority,
          assigned_user_ids: currentFields.assigned_staff || [],
          department_id: currentFields.department_id || null,
          scheduled_date: currentFields.scheduled_date || null,
          scheduled_time: currentFields.scheduled_time || null,
        }),
      });
      const data = await res.json();
      if (data.data) {
        setProjects(prev => prev.map(p => p.id === expandedProjectInTurnover.id ? data.data : p));
        setExpandedProjectInTurnover(data.data);
      }
    } catch (err) {
      console.error('Error saving project:', err);
    } finally {
      setSavingProjectEdit(false);
    }
  }, [expandedProjectInTurnover]);

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

  const handleTurnoverDeleteProject = useCallback(async (project: Project) => {
    if (!confirm(`Delete project "${project.title}"?`)) return;
    try {
      const res = await fetch(`/api/tasks-for-bin/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== project.id));
        setExpandedProjectInTurnover(null);
        setTurnoverProjectFields(null);
      }
    } catch (err) {
      console.error('Error deleting project:', err);
    }
  }, []);

  const handleTurnoverOpenActivity = useCallback(() => {
    if (expandedProjectInTurnover) {
      turnoverActivityHook.fetchProjectActivity(expandedProjectInTurnover.id);
      setTurnoverActivitySheetOpen(true);
    }
  }, [expandedProjectInTurnover, turnoverActivityHook]);

  const createTaskViaApi = useCallback(async (payload: Record<string, unknown>): Promise<Task | null> => {
    try {
      const res = await fetch('/api/tasks-for-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Task', status: 'not_started', priority: 'medium', ...payload }),
      });
      const result = await res.json();
      const data = result.data;
      if (!data) return null;
      return {
        task_id: data.id,
        template_id: undefined,
        template_name: undefined,
        title: data.title || 'New Task',
        description: data.description || null,
        priority: data.priority || 'medium',
        bin_id: data.bin_id || null,
        type: 'project',
        department_id: data.department_id || null,
        department_name: data.department_name || null,
        status: data.status || 'not_started',
        property_name: data.property_name || undefined,
        scheduled_date: data.scheduled_date || null,
        scheduled_time: data.scheduled_time || null,
        assigned_users: (data.project_assignments || []).map((a: any) => ({
          user_id: a.user_id,
          name: a.user?.name || '',
          avatar: a.user?.avatar || '',
          role: a.user?.role || '',
        })),
      } as Task;
    } catch (err) {
      console.error('Error creating task:', err);
      return null;
    }
  }, []);

  const handleTurnoverCreateProject = useCallback(async (propertyName: string) => {
    const newTask = await createTaskViaApi({ property_name: propertyName });
    if (newTask) {
      setExpandedProjectInTurnover(newTask as any);
    }
  }, [createTaskViaApi]);

  const handleCreateProjectFromTimelineCell = useCallback(async (propertyName: string, date: Date) => {
    const scheduledDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const newTask = await createTaskViaApi({ property_name: propertyName, scheduled_date: scheduledDate });
    if (!newTask) return;

    setFloatingData({
      type: 'task',
      item: newTask,
      propertyName,
    });
  }, [createTaskViaApi]);

  const handleCreateProjectFromHeader = useCallback(async () => {
    const newTask = await createTaskViaApi({});
    if (!newTask) return;

    setFloatingData({
      type: 'task',
      item: newTask,
      propertyName: '',
    });
  }, [createTaskViaApi]);

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

        // Sync floating detail panel if viewing this task
        if (floatingData?.type === 'task' && localTask?.task_id === itemId) {
          setLocalTask((prev: Task | null) => {
            if (!prev) return prev;
            const updated = { ...prev };
            if (changes.scheduledDate !== undefined) updated.scheduled_date = changes.scheduledDate;
            if (changes.scheduledTime !== undefined) updated.scheduled_time = changes.scheduledTime;
            if (changes.assigneeId !== undefined) {
              updated.assigned_users = changes.assigneeId
                ? [{ user_id: changes.assigneeId, name: assignedUser?.name || '', avatar: assignedUser?.avatar || '', role: assignedUser?.role || '' }]
                : [];
            }
            return updated;
          });
        }

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

        const res = await fetch(`/api/tasks-for-bin/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projectPayload)
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || 'Failed to update project');
        }

        if (result.data) {
          const d = result.data;
          setProjects(prev =>
            prev.map(p => p.id === itemId ? d : p)
          );
          if (floatingData?.type === 'project' && (floatingData.item as Project).id === itemId) {
            setFloatingData(prev => prev ? { ...prev, item: d } : null);
            setProjectFields({
              title: d.title,
              description: d.description || null,
              status: d.status,
              priority: d.priority,
              assigned_staff: d.project_assignments?.map((a: { user_id: string }) => a.user_id) || [],
              department_id: d.department_id || '',
              scheduled_date: d.scheduled_date || '',
              scheduled_time: d.scheduled_time || '',
            });
          }
        }
      }
    } catch (err) {
      console.error('Error updating column move:', err);
    }
  }, [currentUser?.id, setReservations, setRecurringTasks, users, floatingData, localTask]);

  // Extract ALL tasks from reservations + recurring tasks, tagged with property_name
  const allTasksWithProperty = useMemo(() => {
    const tasks: (Task & { property_name: string })[] = [];
    const seen = new Set<string>();
    // Tasks from reservations (turnover, occupancy, vacancy triggers)
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        if (!seen.has(task.task_id)) {
          seen.add(task.task_id);
          tasks.push({ ...task, property_name: res.property_name });
        }
      });
    });
    // Recurring tasks (property-level, no reservation)
    recurringTasks.forEach((task: any) => {
      if (!seen.has(task.task_id)) {
        seen.add(task.task_id);
        tasks.push({ ...task, property_name: task.property_name });
      }
    });
    return tasks;
  }, [reservations, recurringTasks]);

  // Extract tasks with scheduled_date (for kanban user columns)
  const allScheduledTasks = useMemo(() => {
    return allTasksWithProperty.filter(task => task.scheduled_date);
  }, [allTasksWithProperty]);

  // Note: projects state is kept for TurnoverProjectsPanel but NOT shown on the
  // grid — useTimeline's recurringTasks already includes all non-reservation tasks.

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
      <div className="flex-shrink-0 px-4 py-3 glass-panel bg-white/40 dark:bg-white/[0.06] border-b border-white/20 dark:border-white/[0.08]">
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

          <div className="ml-auto">
            <Button
              onClick={handleCreateProjectFromHeader}
              variant="outline"
              size="sm"
              title="Create Task"
              className="px-3"
            >
              + Task
            </Button>
          </div>
        </div>
      </div>

      {/* Content Area - Grid or Kanban based on viewMode */}
      {viewMode === 'grid' ? (
      <div className="flex-1 overflow-auto px-4 pb-4">
        <div className="overflow-hidden">
          <div
            className="grid border border-white/30 dark:border-white/[0.08] w-full"
            style={{
              gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-white/50 dark:bg-white/[0.10] backdrop-blur-xl px-2 py-1 text-xs font-semibold text-neutral-900 dark:text-white sticky left-0 top-0 z-20 flex items-center gap-1.5">
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
                  className={`px-1 py-1 border-b border-r border-white/20 dark:border-white/[0.07] sticky top-0 z-10 cursor-pointer transition-colors ${
                    isTodayDate 
                      ? 'bg-neutral-500/20 dark:bg-white/[0.13] hover:bg-neutral-500/30 dark:hover:bg-white/[0.16] backdrop-blur-sm' 
                      : 'bg-white/40 dark:bg-white/[0.08] hover:bg-white/55 dark:hover:bg-white/[0.11] backdrop-blur-sm'
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
                        return 'bg-white/55 dark:bg-white/[0.09]';
                      default:
                        return 'bg-white/45 dark:bg-white/[0.07]';
                    }
                  })()
                : 'bg-white/45 dark:bg-white/[0.07]';

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
                                  <ClipboardCheck className="w-3 h-3" />
                                  <span className="text-[10px] font-medium w-3 text-right">
                                    {activeTurnover.tasks?.filter(t => t.status !== 'complete').length || 0}
                                  </span>
                                </div>
                                {/* Projects icon + count */}
                                <div className="flex items-center gap-0.5">
                                  <ClipboardCheck className="w-3 h-3" />
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
                                        <span className="truncate text-sm">{task.title || task.template_name || task.type}</span>
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
                    const startingReservation = propertyReservations.find(res => {
                      const { start } = getBlockPosition(res.check_in, res.check_out);
                      return start === idx;
                    });

                    return (
                      <div
                        key={idx}
                        className={`group border-b border-r border-white/20 dark:border-white/[0.07] h-[30px] relative overflow-visible ${isTodayDate ? 'bg-neutral-500/10 dark:bg-white/[0.07]' : 'bg-white/30 dark:bg-white/[0.045]'}`}
                        onClick={() => {
                          const res = propertyReservations.find(r => {
                            const pos = getBlockPosition(r.check_in, r.check_out);
                            return idx >= pos.start && idx < pos.start + pos.span;
                          });
                          if (res) {
                            setSelectedReservation(selectedReservation?.id === res.id ? null : res);
                          }
                        }}
                      >
                        {startingReservation && (() => {
                          const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingReservation.check_in, startingReservation.check_out);

                          const leftOffset = startsBeforeRange ? 0 : 50;
                          const rightOffset = endsAfterRange ? 0 : 50;
                          const totalWidth = (span * 100) - leftOffset - rightOffset;

                          const diagonalPx = 12;
                          const leftDiagonal = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                          const rightDiagonal = endsAfterRange ? '0px' : `${diagonalPx}px`;
                          const clipPath = `polygon(${leftDiagonal} 0%, 100% 0%, calc(100% - ${rightDiagonal}) 100%, 0% 100%)`;

                          return (
                            <div
                              className={`absolute pointer-events-none transition-all duration-150 text-neutral-800 dark:text-white text-[11px] font-medium flex items-center glass-card glass-sheen overflow-hidden bg-neutral-400/35 dark:bg-white/[0.10] border border-white/40 dark:border-white/[0.12] ${selectedReservation?.id === startingReservation.id ? 'ring-2 ring-white/70 dark:ring-white shadow-lg z-30' : ''}`}
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
                        
                        {/* Scheduled tasks icons */}
                        <ScheduledItemsCell
                          propertyName={property}
                          date={date}
                          tasks={allScheduledTasks}
                          projects={[]}
                          viewMode={view}
                          expanded={expandedProperties.has(property)}
                          onTaskClick={(task) => setFloatingData({
                            type: 'task',
                            item: task,
                            propertyName: property,
                          })}
                        />

                        <button
                          className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-white/40 dark:border-white/20 bg-white/70 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-white/20 hover:text-neutral-900 dark:hover:text-white transition-all z-20 flex items-center justify-center opacity-0 group-hover:opacity-100"
                          title="Create task for this day"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateProjectFromTimelineCell(property, date);
                          }}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}

                  {/* Expanded Detail Row */}
                  {expandedProperties.has(property) && (
                    <>
                      {/* Property column for expanded row — empty */}
                      <div className={`sticky left-0 z-10 border-b border-white/20 dark:border-white/[0.07] ${propertyCellBg} backdrop-blur-sm`} />

                      {/* Date columns for expanded row */}
                      {dateRange.map((date, idx) => {
                        const isTodayDate = isToday(date);
                        const cellDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        const dateTasks = allScheduledTasks.filter(
                          (t) => t.property_name === property && t.scheduled_date === cellDateStr
                        );
                        const hasItems = dateTasks.length > 0;

                        return (
                          <div
                            key={`expanded-${idx}`}
                            className={`border-b border-r border-white/20 dark:border-white/[0.07] p-1.5 ${
                              isTodayDate ? 'bg-neutral-500/10 dark:bg-white/[0.045]' : 'bg-white/20 dark:bg-white/[0.025]'
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
                                    title={task.title || task.template_name || task.type}
                                    onClick={() => setFloatingData({
                                      type: 'task',
                                      item: task,
                                      propertyName: property,
                                    })}
                                  >
                                    <span className="truncate text-sm">{task.title || task.template_name || task.type}</span>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {task.assigned_users?.slice(0, 1).map((user) => (
                                        <div key={user.user_id} className="relative">
                                          <UserAvatar
                                            src={user.avatar}
                                            name={user.name || 'Unknown'}
                                            size="xs"
                                          />
                                          {(task.assigned_users?.length ?? 0) > 1 && (
                                            <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-neutral-700 dark:bg-neutral-200 text-[9px] font-medium text-white dark:text-neutral-800 border border-white dark:border-neutral-900">
                                              +{(task.assigned_users?.length ?? 0) - 1}
                                            </div>
                                          )}
                                        </div>
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
            projects={[]}
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
          {floatingData.type === 'task' && taskAsProject && taskEditingFields ? (
            <ProjectDetailPanel
              project={taskAsProject}
              editingFields={taskEditingFields}
              setEditingFields={setTaskEditingFields}
              users={users}
              allProperties={allProperties}
              savingEdit={false}
              onSave={handleSaveTaskEditFields}
              onDelete={async () => {
                const task = localTask || floatingData.item as Task;
                try {
                  await fetch(`/api/tasks-for-bin/${task.task_id}`, { method: 'DELETE' });
                  setRecurringTasks(prev => prev.filter((t: any) => t.task_id !== task.task_id));
                  fetchReservations();
                } catch (err) {
                  console.error('Error deleting task:', err);
                }
                handleCloseFloatingWindow();
              }}
              onClose={handleCloseFloatingWindow}
              onOpenActivity={() => {}}
              staffOpen={taskStaffOpen}
              setStaffOpen={setTaskStaffOpen}
              // Template / checklist slide-over
              template={resolvedTaskTemplate || undefined}
              formMetadata={(localTask || floatingData.item as Task).form_metadata}
              onSaveForm={async (formData) => {
                const task = localTask || floatingData.item as Task;
                await handleSaveTaskForm(task.task_id, formData);
              }}
              loadingTemplate={loadingTaskTemplate === (localTask || floatingData.item as Task).template_id}
              currentUser={currentUser}
              // Template picker
              availableTemplates={availableTemplates}
              onTemplateChange={async (templateId) => {
                const task = localTask || floatingData.item as Task;
                try {
                  await fetch('/api/update-task-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: task.task_id, fields: { template_id: templateId || null } }),
                  });
                  setLocalTask(prev => prev ? { ...prev, template_id: templateId || undefined } : prev);
                  if (templateId) {
                    fetchTaskTemplate(templateId, task.property_name);
                  }
                } catch (err) {
                  console.error('Error changing template:', err);
                }
              }}
              // Turnover context
              onShowTurnover={
                (localTask || floatingData.item as any)?.is_recurring
                  ? undefined
                  : handleShowTurnover
              }
              // Comments
              comments={taskCommentsHook.projectComments}
              loadingComments={taskCommentsHook.loadingComments}
              newComment={taskNewComment}
              setNewComment={setTaskNewComment}
              postingComment={taskCommentsHook.postingComment}
              onPostComment={async () => {
                const task = localTask || floatingData.item as Task;
                if (taskNewComment.trim()) {
                  await taskCommentsHook.postProjectComment(task.task_id, taskNewComment, 'task');
                  setTaskNewComment('');
                }
              }}
              // Attachments
              attachments={taskAttachmentsHook.projectAttachments}
              loadingAttachments={taskAttachmentsHook.loadingAttachments}
              uploadingAttachment={taskAttachmentsHook.uploadingAttachment}
              attachmentInputRef={taskAttachmentsHook.attachmentInputRef}
              onAttachmentUpload={(e) => {
                const task = localTask || floatingData.item as Task;
                taskAttachmentsHook.handleAttachmentUpload(e, task.task_id, 'task');
              }}
              onViewAttachment={(index) => setTaskViewingAttachmentIndex(index)}
              // Time tracking
              activeTimeEntry={taskTimeTrackingHook.activeTimeEntry}
              displaySeconds={taskTimeTrackingHook.displaySeconds}
              formatTime={taskTimeTrackingHook.formatTime}
              onStartTimer={() => {
                const task = localTask || floatingData.item as Task;
                taskTimeTrackingHook.startProjectTimer(task.task_id, 'task');
              }}
              onStopTimer={taskTimeTrackingHook.stopProjectTimer}
              // Bins
              bins={binsHook.bins}
              onBinChange={async (binId) => {
                const task = localTask || floatingData.item as Task;
                try {
                  await fetch('/api/update-task-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: task.task_id, fields: { bin_id: binId || null } }),
                  });
                  setLocalTask(prev => prev ? { ...prev, bin_id: binId || null } : prev);
                  binsHook.fetchBins();
                } catch (err) {
                  console.error('Error updating bin:', err);
                }
              }}
              onIsBinnedChange={async (isBinned) => {
                const task = localTask || floatingData.item as Task;
                try {
                  const fields: Record<string, unknown> = { is_binned: isBinned };
                  if (!isBinned) fields.bin_id = null;
                  await fetch('/api/update-task-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: task.task_id, fields }),
                  });
                  setLocalTask(prev => prev ? { ...prev, is_binned: isBinned, ...(isBinned ? {} : { bin_id: null }) } : prev);
                  binsHook.fetchBins();
                } catch (err) {
                  console.error('Error updating is_binned:', err);
                }
              }}
            />
          ) : floatingData.type === 'project' && projectFields ? (
            <ProjectDetailPanel
              project={floatingData.item as Project}
              users={users}
              allProperties={allProperties}
              editingFields={projectFields}
              setEditingFields={setProjectFields}
              savingEdit={savingProjectEdit}
              onSave={handleSaveProject}
              onDelete={handleDeleteProject}
              onClose={handleCloseFloatingWindow}
              onOpenActivity={handleOpenActivity}
              onPropertyChange={async (_propertyId, propertyName) => {
                const project = floatingData.item as Project;
                try {
                  const res = await fetch(`/api/tasks-for-bin/${project.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ property_name: propertyName || null }),
                  });
                  const data = await res.json();
                  if (data.data) {
                    setProjects(prev => prev.map(p => p.id === project.id ? data.data : p));
                    setFloatingData(prev => {
                      if (!prev || prev.type !== 'project') return prev;
                      return { ...prev, item: data.data, propertyName: propertyName || '' };
                    });
                  }
                } catch (err) {
                  console.error('Error updating property:', err);
                }
              }}
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
              // Bins
              bins={binsHook.bins}
              onBinChange={async (binId) => {
                const project = floatingData.item as Project;
                try {
                  const res = await fetch(`/api/tasks-for-bin/${project.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bin_id: binId || null }),
                  });
                  const data = await res.json();
                  if (data.data) {
                    setProjects(prev => prev.map(p => p.id === project.id ? data.data : p));
                    setFloatingData(prev => {
                      if (!prev || prev.type !== 'project') return prev;
                      return { ...prev, item: data.data };
                    });
                  }
                } catch (err) {
                  console.error('Error updating bin:', err);
                }
                binsHook.fetchBins();
              }}
              onIsBinnedChange={async (isBinned) => {
                const project = floatingData.item as Project;
                try {
                  const payload: Record<string, unknown> = { is_binned: isBinned };
                  if (!isBinned) payload.bin_id = null;
                  const res = await fetch(`/api/tasks-for-bin/${project.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  const data = await res.json();
                  if (data.data) {
                    setProjects(prev => prev.map(p => p.id === project.id ? data.data : p));
                    setFloatingData(prev => {
                      if (!prev || prev.type !== 'project') return prev;
                      return { ...prev, item: data.data };
                    });
                  }
                } catch (err) {
                  console.error('Error updating is_binned:', err);
                }
                binsHook.fetchBins();
              }}
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
                    savingProject={savingProjectEdit}
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

      {/* Task Attachment Lightbox */}
      <AttachmentLightbox
        attachments={taskAttachmentsHook.projectAttachments}
        viewingIndex={taskViewingAttachmentIndex}
        onClose={() => setTaskViewingAttachmentIndex(null)}
        onNavigate={setTaskViewingAttachmentIndex}
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
