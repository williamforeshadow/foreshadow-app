'use client';

import { apiFetch } from '@/lib/apiFetch';
import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ensureTemplateDetail, fetchJson, qk } from '@/lib/queries';
import type { CleaningFilters } from '@/lib/cleaningFilters';
import type { Turnover, Task, TurnoverStatus } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

async function fetchTurnoversData(): Promise<Turnover[]> {
  const json = await fetchJson<{ data?: Turnover[] }>('/api/turnovers');
  return json.data ?? [];
}

// Drives the Turnovers window (cards list + reservation detail) and is also
// consumed by the mobile shell for the shared task-edit pipeline (status /
// schedule / assignments / template cache). The TurnoversWindow itself no
// longer mutates tasks directly — it hands clicked tasks off to the shared
// PropertyTaskDetailOverlay, which owns its own mutation surface — so the
// per-task helpers below exist solely to keep MobileApp.tsx's task editor
// working until that surface migrates to PropertyTaskDetailOverlay too.
export function useTurnovers() {
  const queryClient = useQueryClient();

  // Core data — shared cache: the desktop Turnovers window and the mobile
  // task-edit pipeline share one /api/turnovers fetch. Mutation errors keep a
  // local channel (setError) merged with the query's fetch error below.
  const query = useQuery({ queryKey: qk.turnovers, queryFn: fetchTurnoversData });
  const response = query.data ?? null;
  const [mutationError, setError] = useState<string | null>(null);
  const error =
    mutationError ?? (query.error ? query.error.message || 'Failed to fetch turnovers' : null);
  const loading = query.isLoading;

  // View state
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [filters, setFilters] = useState<CleaningFilters>({
    turnoverStatus: [],
    occupancyStatus: [],
    timeline: [],
    properties: [],
    search: '',
  });
  const [sortBy, setSortBy] = useState('status-priority');

  // Selection state — the Turnovers window owns its own selectedTask /
  // overlay state now; we just track the highlighted card here.
  const [selectedCard, setSelectedCard] = useState<Turnover | null>(null);

  // Per-task template cache + loading. Keyed by `${templateId}__${propertyName}`
  // so property-level overrides resolve correctly. Mobile's task editor
  // consumes this directly; TurnoversWindow no longer needs it (the shared
  // overlay maintains its own cache).
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);

  // Refs
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const selectedCardIdRef = useRef<string | null>(null);
  selectedCardIdRef.current = selectedCard?.id || null;

  // Refetch shim — the query owns the mount fetch. Refetches keep existing
  // cards visible while fresh data loads (no more flash-to-skeleton).
  const { refetch: refetchTurnovers } = query;
  const fetchTurnovers = useCallback(async () => {
    setError(null);
    await refetchTurnovers();
  }, [refetchTurnovers]);

  // Optimistic cache patch used by the task mutators below. cancelQueries
  // drops any in-flight background refetch so its pre-mutation response
  // can't land after — and silently revert — the optimistic write.
  const patchResponse = useCallback(
    (updater: (prev: Turnover[] | null) => Turnover[] | null) => {
      queryClient.cancelQueries({ queryKey: qk.turnovers });
      queryClient.setQueryData<Turnover[]>(qk.turnovers, (old) => {
        const next = updater(old ?? null);
        return next ?? old;
      });
    },
    [queryClient]
  );

  // Filter functions. `toggleFilter` only operates on the array-typed
  // filter axes (status/occupancy/timeline/properties); the free-text
  // search is set via `setSearch` instead.
  const toggleFilter = useCallback(
    (category: 'turnoverStatus' | 'occupancyStatus' | 'timeline' | 'properties', value: string) => {
      setFilters(prev => ({
        ...prev,
        [category]: prev[category].includes(value)
          ? prev[category].filter(v => v !== value)
          : [...prev[category], value]
      }));
    },
    []
  );

  // Bulk setter for a multi-select axis — used by the MultiSelect chip
  // (which emits the full next Set on every change).
  const setFilterValues = useCallback(
    (category: 'turnoverStatus' | 'occupancyStatus' | 'timeline' | 'properties', values: string[]) => {
      setFilters(prev => ({ ...prev, [category]: values }));
    },
    []
  );

  const setSearch = useCallback((value: string) => {
    setFilters(prev => ({ ...prev, search: value }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      turnoverStatus: [],
      occupancyStatus: [],
      timeline: [],
      properties: [],
      search: '',
    });
  }, []);

  const getActiveFilterCount = useCallback(() => {
    return (
      filters.turnoverStatus.length +
      filters.occupancyStatus.length +
      filters.timeline.length +
      filters.properties.length +
      (filters.search.trim() ? 1 : 0)
    );
  }, [filters]);

  // Helper to recalculate turnover_status on the cached card after a task
  // mutation. Contingent tasks intentionally don't count toward turnover
  // progress.
  const calculateTurnoverStatus = (tasks: Task[]): TurnoverStatus => {
    const activeTasks = tasks.filter((t) => t.status !== 'contingent');
    const total = activeTasks.length;
    const completed = activeTasks.filter((t) => t.status === 'complete').length;
    const inProgress = activeTasks.filter((t) => t.status === 'in_progress' || t.status === 'paused').length;

    if (total === 0) return 'no_tasks';
    if (completed === total) return 'complete';
    if (inProgress > 0 || completed > 0) return 'in_progress';
    return 'not_started';
  };

  // ---- Task mutators (mobile-only consumers post-refactor) ---------------

  const updateTaskAction = useCallback(async (taskId: string, action: string) => {
    try {
      // Save form data if there's a form open
      if ((window as any).__currentFormSave) {
        await (window as any).__currentFormSave();
      }

      const res = await apiFetch('/api/update-task-action', {
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
      patchResponse((prevResponse) => {
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
  }, [patchResponse]);

  const updateTaskAssignment = useCallback(async (taskId: string, userIds: string[]) => {
    try {
      const res = await apiFetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userIds })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to update task assignment');
      }

      // Transform task_assignments to assigned_users format expected by UI
      const assignedUsers = (result.data?.task_assignments || []).map(
        (ta: { user_id: string; users?: { name?: string; avatar?: string; role?: string } }) => ({
          user_id: ta.user_id,
          name: ta.users?.name || '',
          avatar: ta.users?.avatar || '',
          role: ta.users?.role || ''
        })
      );

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
      patchResponse((prevResponse) => {
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
  }, [patchResponse]);

  const updateTaskSchedule = useCallback(
    async (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => {
      try {
        const res = await apiFetch('/api/update-task-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, scheduledDate, scheduledTime })
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
              ? { ...task, scheduled_date: scheduledDate, scheduled_time: scheduledTime }
              : task
          );

          return { ...prev, tasks: updatedTasks };
        });

        // Update response array
        patchResponse((prevResponse) => {
          if (!prevResponse) return prevResponse;

          return prevResponse.map((item) => {
            if (item.id === selectedCardIdRef.current && item.tasks) {
              const updatedTasks = item.tasks.map((task) =>
                task.task_id === taskId
                  ? { ...task, scheduled_date: scheduledDate, scheduled_time: scheduledTime }
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
    },
    [patchResponse]
  );

  const fetchTaskTemplate = useCallback(
    async (templateId: string, propertyName?: string) => {
      // Cache key includes property name so property-level overrides are
      // handled correctly.
      const cacheKey = propertyName ? `${templateId}__${propertyName}` : templateId;

      if (taskTemplates[cacheKey]) {
        return taskTemplates[cacheKey];
      }

      setLoadingTaskTemplate(templateId);
      try {
        const template = await ensureTemplateDetail(queryClient, templateId, propertyName);
        setTaskTemplates(prev => ({ ...prev, [cacheKey]: template }));
        return template;
      } catch (err) {
        console.error('Error fetching template:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch template');
        return null;
      } finally {
        setLoadingTaskTemplate(null);
      }
    },
    [taskTemplates, queryClient]
  );

  const saveTaskForm = useCallback(
    async (taskId: string, formData: Record<string, unknown>) => {
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
          patchResponse((prevResponse) => {
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
    },
    [patchResponse]
  );

  // Close selected card. The Turnovers window's selectedTask state is local,
  // so we just clear the card selection here; the window's effect on
  // selectedCard?.id handles overlay teardown.
  const closeSelectedCard = useCallback(() => {
    setSelectedCard(null);
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
    setFilterValues,
    setSearch,
    clearAllFilters,
    getActiveFilterCount,

    // Selection
    selectedCard,
    setSelectedCard,
    closeSelectedCard,

    // Task template cache (mobile-only)
    taskTemplates,
    loadingTaskTemplate,

    // Task actions (mobile-only)
    updateTaskAction,
    updateTaskAssignment,
    updateTaskSchedule,
    fetchTaskTemplate,
    saveTaskForm,

    // Refs
    rightPanelRef,
    scrollPositionRef,
  };
}
