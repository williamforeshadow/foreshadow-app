'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TaskStatus, TaskType, AssignedUser } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface TaskRow {
  task_id: string;
  reservation_id: string | null;
  template_id: string | null;
  template_name: string;
  type: TaskType;
  status: TaskStatus;
  scheduled_start: string | null;
  form_metadata: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
  // Reservation context
  property_name: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  next_check_in: string | null;
  // Computed
  isActive: boolean;
  // Assignments
  assigned_users: AssignedUser[];
}

export interface TaskSummary {
  total: number;
  not_started: number;
  in_progress: number;
  complete: number;
  by_type: {
    cleaning: number;
    maintenance: number;
  };
}

export type TimelineFilter = 'active' | 'inactive';

export interface TaskFilters {
  status: TaskStatus[];
  type: TaskType[];
  timeline: TimelineFilter[];
  searchQuery: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useTasks() {
  // Core data state
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState<TaskFilters>({
    status: [],
    type: [],
    timeline: [],
    searchQuery: ''
  });

  // Sort state
  const [sortBy, setSortBy] = useState<'created_at' | 'scheduled_start' | 'property_name' | 'status'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Selection state
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/all-tasks');
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch tasks');
      }

      setTasks(result.data || []);
      setSummary(result.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ============================================================================
  // Filtering & Sorting
  // ============================================================================

  // Compute isActive for each task based on check_in and next_check_in
  // Active: check_in <= now < next_check_in
  // Inactive: now < check_in (upcoming) OR now >= next_check_in (past)
  const tasksWithActiveStatus = useMemo(() => {
    const now = new Date();
    
    return tasks.map(task => {
      const checkIn = task.check_in ? new Date(task.check_in) : null;
      const nextCheckIn = task.next_check_in ? new Date(task.next_check_in) : null;
      
      // Active if: check_in has passed AND (no next_check_in OR next_check_in hasn't happened yet)
      const isActive = checkIn !== null && 
        now >= checkIn && 
        (nextCheckIn === null || now < nextCheckIn);
      
      return { ...task, isActive };
    });
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasksWithActiveStatus];

    // Filter by timeline (active/inactive)
    if (filters.timeline.length > 0 && filters.timeline.length < 2) {
      // Only filter if one option is selected (not both)
      if (filters.timeline.includes('active')) {
        result = result.filter(task => task.isActive);
      } else if (filters.timeline.includes('inactive')) {
        result = result.filter(task => !task.isActive);
      }
    }

    // Filter by status
    if (filters.status.length > 0) {
      result = result.filter(task => filters.status.includes(task.status));
    }

    // Filter by type
    if (filters.type.length > 0) {
      result = result.filter(task => filters.type.includes(task.type));
    }

    // Filter by search query
    if (filters.searchQuery.trim()) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(task =>
        task.property_name.toLowerCase().includes(query) ||
        task.template_name.toLowerCase().includes(query) ||
        task.guest_name?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'created_at':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'scheduled_start':
          const aDate = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
          const bDate = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
          comparison = aDate - bDate;
          break;
        case 'property_name':
          comparison = a.property_name.localeCompare(b.property_name);
          break;
        case 'status':
          const statusOrder: Record<TaskStatus, number> = {
            'not_started': 0,
            'in_progress': 1,
            'paused': 2,
            'reopened': 3,
            'complete': 4
          };
          comparison = statusOrder[a.status] - statusOrder[b.status];
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [tasksWithActiveStatus, filters, sortBy, sortOrder]);

  // ============================================================================
  // Filter Actions
  // ============================================================================

  const toggleStatusFilter = useCallback((status: TaskStatus) => {
    setFilters(prev => ({
      ...prev,
      status: prev.status.includes(status)
        ? prev.status.filter(s => s !== status)
        : [...prev.status, status]
    }));
  }, []);

  const toggleTypeFilter = useCallback((type: TaskType) => {
    setFilters(prev => ({
      ...prev,
      type: prev.type.includes(type)
        ? prev.type.filter(t => t !== type)
        : [...prev.type, type]
    }));
  }, []);

  const toggleTimelineFilter = useCallback((timeline: TimelineFilter) => {
    setFilters(prev => ({
      ...prev,
      timeline: prev.timeline.includes(timeline)
        ? prev.timeline.filter(t => t !== timeline)
        : [...prev.timeline, timeline]
    }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setFilters(prev => ({ ...prev, searchQuery: query }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      status: [],
      type: [],
      timeline: [],
      searchQuery: ''
    });
  }, []);

  const getActiveFilterCount = useCallback(() => {
    return filters.status.length + filters.type.length + filters.timeline.length + (filters.searchQuery ? 1 : 0);
  }, [filters]);

  // ============================================================================
  // Task Actions (update local state optimistically)
  // ============================================================================

  const updateTaskInState = useCallback((taskId: string, updates: Partial<TaskRow>) => {
    setTasks(prev => prev.map(task =>
      task.task_id === taskId ? { ...task, ...updates } : task
    ));

    // Update selected task if it's the one being modified
    setSelectedTask(prev =>
      prev?.task_id === taskId ? { ...prev, ...updates } : prev
    );
  }, []);

  // ============================================================================
  // Return API
  // ============================================================================

  return {
    // Core data
    tasks: filteredTasks,
    allTasks: tasksWithActiveStatus,
    summary,
    loading,
    error,
    fetchTasks,

    // Filters
    filters,
    toggleStatusFilter,
    toggleTypeFilter,
    toggleTimelineFilter,
    setSearchQuery,
    clearFilters,
    getActiveFilterCount,

    // Sorting
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,

    // Selection
    selectedTask,
    setSelectedTask,

    // Actions
    updateTaskInState,
  };
}

