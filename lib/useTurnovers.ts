'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { CleaningFilters } from '@/lib/cleaningFilters';
import type { Turnover, Task, TurnoverStatus, TaskTemplate } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

export function useTurnovers() {
  // Core data state
  const [response, setResponse] = useState<Turnover[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // View state
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [filters, setFilters] = useState<CleaningFilters>({
    turnoverStatus: [],
    occupancyStatus: [],
    timeline: [],
  });
  const [sortBy, setSortBy] = useState('status-priority');

  // Selection state
  const [selectedCard, setSelectedCard] = useState<Turnover | null>(null);
  const [fullscreenTask, setFullscreenTask] = useState<Task | null>(null);
  const [rightPanelView, setRightPanelView] = useState<'tasks' | 'projects'>('tasks');

  // Task state - using Template from DynamicCleaningForm
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  // Refs
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const selectedCardIdRef = useRef<string | null>(null);
  selectedCardIdRef.current = selectedCard?.id || null;

  // Fetch turnovers
  const fetchTurnovers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_property_turnovers', {});

      if (rpcError) {
        setError(rpcError.message);
      } else {
        setResponse(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch turnovers');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    fetchTurnovers();
  }, [fetchTurnovers]);

  // Filter functions
  const toggleFilter = useCallback((category: keyof CleaningFilters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value]
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      turnoverStatus: [],
      occupancyStatus: [],
      timeline: [],
    });
  }, []);

  const getActiveFilterCount = useCallback(() => {
    return filters.turnoverStatus.length + filters.occupancyStatus.length + filters.timeline.length;
  }, [filters]);

  // Helper to calculate turnover_status
  const calculateTurnoverStatus = (tasks: Task[]): TurnoverStatus => {
    // Exclude contingent tasks from turnover status calculation
    const activeTasks = tasks.filter((t) => t.status !== 'contingent');
    const total = activeTasks.length;
    const completed = activeTasks.filter((t) => t.status === 'complete').length;
    const inProgress = activeTasks.filter((t) => t.status === 'in_progress').length;

    if (total === 0) return 'no_tasks';
    if (completed === total) return 'complete';
    if (inProgress > 0 || completed > 0) return 'in_progress';
    return 'not_started';
  };

  // Task actions
  const updateTaskAction = useCallback(async (taskId: string, action: string) => {
    try {
      // Save form data if there's a form open
      if ((window as any).__currentFormSave) {
        await (window as any).__currentFormSave();
      }

      const res = await fetch('/api/update-task-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to update task action');
      }

      // Update the task in selectedCard.tasks array
      setSelectedCard((prev) => {
        if (!prev || !prev.tasks) return prev;

        const updatedTasks = prev.tasks.map((task) =>
          task.task_id === taskId
            ? { ...task, status: action as Task['status'] }
            : task
        );

        const completedCount = updatedTasks.filter((t) => t.status === 'complete').length;
        const inProgressCount = updatedTasks.filter((t) => t.status === 'in_progress').length;
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);

        return {
          ...prev,
          tasks: updatedTasks,
          completed_tasks: completedCount,
          tasks_in_progress: inProgressCount,
          turnover_status: newTurnoverStatus
        };
      });

      // Also update the response array
      setResponse((prevResponse) => {
        if (!prevResponse) return prevResponse;

        return prevResponse.map((item) => {
          if (item.id === selectedCardIdRef.current && item.tasks) {
            const updatedTasks = item.tasks.map((task) =>
              task.task_id === taskId
                ? { ...task, status: action as Task['status'] }
                : task
            );
            const completedCount = updatedTasks.filter((t) => t.status === 'complete').length;
            const inProgressCount = updatedTasks.filter((t) => t.status === 'in_progress').length;
            const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);

            return {
              ...item,
              tasks: updatedTasks,
              completed_tasks: completedCount,
              tasks_in_progress: inProgressCount,
              turnover_status: newTurnoverStatus
            };
          }
          return item;
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task action');
    }
  }, []);

  const updateTaskAssignment = useCallback(async (taskId: string, userIds: string[]) => {
    try {
      const res = await fetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userIds })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to update task assignment');
      }

      // Transform task_assignments to assigned_users format expected by UI
      const assignedUsers = (result.data?.task_assignments || []).map((ta: { user_id: string; users?: { name?: string; avatar?: string; role?: string } }) => ({
        user_id: ta.user_id,
        name: ta.users?.name || '',
        avatar: ta.users?.avatar || '',
        role: ta.users?.role || ''
      }));

      // Update the task in selectedCard
      setSelectedCard((prev) => {
        if (!prev || !prev.tasks) return prev;

        const updatedTasks = prev.tasks.map((task) =>
          task.task_id === taskId
            ? { ...task, assigned_users: assignedUsers }
            : task
        );

        return { ...prev, tasks: updatedTasks };
      });

      // Update response array
      setResponse((prevResponse) => {
        if (!prevResponse) return prevResponse;

        return prevResponse.map((item) => {
          if (item.id === selectedCardIdRef.current && item.tasks) {
            const updatedTasks = item.tasks.map((task) =>
              task.task_id === taskId
                ? { ...task, assigned_users: assignedUsers }
                : task
            );
            return { ...item, tasks: updatedTasks };
          }
          return item;
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task assignment');
    }
  }, []);

  const updateTaskSchedule = useCallback(async (taskId: string, dateTime: string | null) => {
    try {
      const res = await fetch('/api/update-task-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, scheduledStart: dateTime })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to update task schedule');
      }

      // Update the task in selectedCard
      setSelectedCard((prev) => {
        if (!prev || !prev.tasks) return prev;

        const updatedTasks = prev.tasks.map((task) =>
          task.task_id === taskId
            ? { ...task, scheduled_start: dateTime }
            : task
        );

        return { ...prev, tasks: updatedTasks };
      });

      // Update response array
      setResponse((prevResponse) => {
        if (!prevResponse) return prevResponse;

        return prevResponse.map((item) => {
          if (item.id === selectedCardIdRef.current && item.tasks) {
            const updatedTasks = item.tasks.map((task) =>
              task.task_id === taskId
                ? { ...task, scheduled_start: dateTime }
                : task
            );
            return { ...item, tasks: updatedTasks };
          }
          return item;
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task schedule');
    }
  }, []);

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
      setError(err instanceof Error ? err.message : 'Failed to fetch template');
      return null;
    } finally {
      setLoadingTaskTemplate(null);
    }
  }, [taskTemplates]);

  const saveTaskForm = useCallback(async (taskId: string, formData: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/save-task-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, formData })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to save task form');
      }

      // Update the task in selectedCard
      setSelectedCard((prev) => {
        if (!prev || !prev.tasks) return prev;

        const updatedTasks = prev.tasks.map((task) =>
          task.task_id === taskId
            ? { ...task, form_metadata: formData }
            : task
        );

        return { ...prev, tasks: updatedTasks };
      });

      // Update response array
      const currentSelectedCardId = selectedCardIdRef.current;
      if (currentSelectedCardId) {
        setResponse((prevResponse) => {
          if (!prevResponse) return prevResponse;

          return prevResponse.map((item) => {
            if (item.id === currentSelectedCardId && item.tasks) {
              const updatedTasks = item.tasks.map((task) =>
                task.task_id === taskId
                  ? { ...task, form_metadata: formData }
                  : task
              );
              return { ...item, tasks: updatedTasks };
            }
            return item;
          });
        });
      }

      return result;
    } catch (err) {
      console.error('Error saving task form:', err);
      setError(err instanceof Error ? err.message : 'Failed to save task form');
      throw err;
    }
  }, []);

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

  const addTaskToCard = useCallback(async (templateId: string) => {
    if (!selectedCard) return;

    setAddingTask(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: selectedCard.id,
          template_id: templateId
        })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to add task');
      }

      const newTask = result.data as Task;

      // Update selectedCard with new task
      setSelectedCard((prev) => {
        if (!prev) return prev;

        const updatedTasks = [...(prev.tasks || []), newTask];
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);

        return {
          ...prev,
          tasks: updatedTasks,
          total_tasks: updatedTasks.length,
          completed_tasks: updatedTasks.filter((t) => t.status === 'complete').length,
          tasks_in_progress: updatedTasks.filter((t) => t.status === 'in_progress').length,
          turnover_status: newTurnoverStatus
        };
      });

      // Update response array
      setResponse((prevResponse) => {
        if (!prevResponse) return prevResponse;

        return prevResponse.map((item) => {
          if (item.id === selectedCard.id) {
            const updatedTasks = [...(item.tasks || []), newTask];
            const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);

            return {
              ...item,
              tasks: updatedTasks,
              total_tasks: updatedTasks.length,
              completed_tasks: updatedTasks.filter((t) => t.status === 'complete').length,
              tasks_in_progress: updatedTasks.filter((t) => t.status === 'in_progress').length,
              turnover_status: newTurnoverStatus
            };
          }
          return item;
        });
      });

      setShowAddTaskDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add task');
    } finally {
      setAddingTask(false);
    }
  }, [selectedCard]);

  const deleteTaskFromCard = useCallback(async (taskId: string) => {
    if (!selectedCard) return;

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE'
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to delete task');
      }

      // Update selectedCard
      setSelectedCard((prev) => {
        if (!prev) return prev;

        const updatedTasks = (prev.tasks || []).filter((t) => t.task_id !== taskId);
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);

        return {
          ...prev,
          tasks: updatedTasks,
          total_tasks: updatedTasks.length,
          completed_tasks: updatedTasks.filter((t) => t.status === 'complete').length,
          tasks_in_progress: updatedTasks.filter((t) => t.status === 'in_progress').length,
          turnover_status: newTurnoverStatus
        };
      });

      // Update response array
      setResponse((prevResponse) => {
        if (!prevResponse) return prevResponse;

        return prevResponse.map((item) => {
          if (item.id === selectedCard.id) {
            const updatedTasks = (item.tasks || []).filter((t) => t.task_id !== taskId);
            const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);

            return {
              ...item,
              tasks: updatedTasks,
              total_tasks: updatedTasks.length,
              completed_tasks: updatedTasks.filter((t) => t.status === 'complete').length,
              tasks_in_progress: updatedTasks.filter((t) => t.status === 'in_progress').length,
              turnover_status: newTurnoverStatus
            };
          }
          return item;
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
    }
  }, [selectedCard]);

  // Close selected card
  const closeSelectedCard = useCallback(() => {
    setSelectedCard(null);
    setShowAddTaskDialog(false);
    setFullscreenTask(null);
    setRightPanelView('tasks');
  }, []);

  return {
    // Core data
    response,
    error,
    loading,
    fetchTurnovers,

    // View state
    viewMode,
    setViewMode,
    filters,
    sortBy,
    setSortBy,

    // Filter functions
    toggleFilter,
    clearAllFilters,
    getActiveFilterCount,

    // Selection
    selectedCard,
    setSelectedCard,
    closeSelectedCard,
    fullscreenTask,
    setFullscreenTask,
    rightPanelView,
    setRightPanelView,

    // Task state
    taskTemplates,
    loadingTaskTemplate,
    availableTemplates,
    showAddTaskDialog,
    setShowAddTaskDialog,
    addingTask,

    // Task actions
    updateTaskAction,
    updateTaskAssignment,
    updateTaskSchedule,
    fetchTaskTemplate,
    saveTaskForm,
    fetchAvailableTemplates,
    addTaskToCard,
    deleteTaskFromCard,

    // Refs
    rightPanelRef,
    scrollPositionRef,
  };
}
