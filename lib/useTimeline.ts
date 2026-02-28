'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';

export function useTimeline() {
  const [reservations, setReservations] = useState<any[]>([]);
  const [recurringTasks, setRecurringTasks] = useState<any[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Start from yesterday
    return today;
  });
  const [dateRange, setDateRange] = useState<Date[]>([]);

  // Generate date range based on view and anchor date
  const generateDateRange = useCallback(() => {
    const dates: Date[] = [];
    const numDays = view === 'week' ? 7 : 30;

    for (let i = 0; i < numDays; i++) {
      const date = new Date(anchorDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }

    setDateRange(dates);
  }, [view, anchorDate]);

  useEffect(() => {
    generateDateRange();
  }, [generateDateRange]);

  // Fetch reservations + recurring tasks on mount
  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch reservations (turnovers) and recurring tasks in parallel
      const [turnoversResult, recurringResult] = await Promise.all([
        supabase.rpc('get_property_turnovers'),
        supabase
          .from('turnover_tasks')
          .select(`
            id,
            property_name,
            template_id,
            type,
            status,
            scheduled_date,
            scheduled_time,
            form_metadata,
            completed_at,
            created_at,
            updated_at,
            templates(id, name, type),
            task_assignments(user_id, users(id, name, avatar, role))
          `)
          .is('reservation_id', null)
          .order('scheduled_date', { ascending: true, nullsFirst: false }),
      ]);

      if (turnoversResult.error) throw turnoversResult.error;

      const turnoversData = turnoversResult.data || [];
      setReservations(turnoversData);

      // Transform recurring tasks to match the Task shape
      const recurringData = (recurringResult.data || []).map((t: any) => ({
        task_id: t.id,
        template_id: t.template_id,
        template_name: t.templates?.name || 'Unnamed Task',
        type: t.type || t.templates?.type || 'cleaning',
        status: t.status || 'not_started',
        scheduled_date: t.scheduled_date,
        scheduled_time: t.scheduled_time,
        form_metadata: t.form_metadata,
        completed_at: t.completed_at,
        property_name: t.property_name,
        is_recurring: true,
        assigned_users: (t.task_assignments || []).map((a: any) => ({
          user_id: a.user_id,
          name: a.users?.name || '',
          avatar: a.users?.avatar || '',
          role: a.users?.role || '',
        })),
      }));
      setRecurringTasks(recurringData);

      // Get unique properties from both turnovers AND recurring tasks, sorted alphabetically
      const turnoverProps = turnoversData.map((r: any) => r.property_name);
      const recurringProps = recurringData.map((t: any) => t.property_name);
      const uniqueProps = Array.from(new Set([...turnoverProps, ...recurringProps]))
        .filter(Boolean)
        .sort();
      setProperties(uniqueProps as string[]);
    } catch (err: any) {
      console.error('Error fetching reservations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // Navigation functions
  const goToPrevious = useCallback(() => {
    const daysToShift = view === 'week' ? 7 : 30;
    const newAnchor = new Date(anchorDate);
    newAnchor.setDate(newAnchor.getDate() - daysToShift);
    setAnchorDate(newAnchor);
  }, [view, anchorDate]);

  const goToNext = useCallback(() => {
    const daysToShift = view === 'week' ? 7 : 30;
    const newAnchor = new Date(anchorDate);
    newAnchor.setDate(newAnchor.getDate() + daysToShift);
    setAnchorDate(newAnchor);
  }, [view, anchorDate]);

  const goToToday = useCallback(() => {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Start from yesterday
    setAnchorDate(today);
  }, []);

  // Helper functions
  const formatDate = useCallback((date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const isToday = useCallback((date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }, []);

  const getReservationsForProperty = useCallback((propertyName: string) => {
    return reservations.filter(r => r.property_name === propertyName);
  }, [reservations]);

  const getBlockPosition = useCallback((checkIn: string, checkOut: string) => {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const firstVisibleDate = dateRange[0];
    const lastVisibleDate = dateRange[dateRange.length - 1];

    if (!firstVisibleDate || !lastVisibleDate) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }

    // Helper to compare just the date portion (ignoring time/timezone issues)
    const toDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const compareDates = (d1: Date, d2: Date) => toDateString(d1).localeCompare(toDateString(d2));

    // Case 1: Reservation ends before visible range - don't show
    if (compareDates(checkOutDate, firstVisibleDate) < 0) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }

    // Case 2: Reservation starts after visible range - don't show
    if (compareDates(checkInDate, lastVisibleDate) > 0) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }

    // Track if reservation extends beyond visible range
    const startsBeforeRange = compareDates(checkInDate, firstVisibleDate) < 0;
    const endsAfterRange = compareDates(checkOutDate, lastVisibleDate) > 0;

    // Case 3: Reservation overlaps with visible range
    let startIdx = dateRange.findIndex(d =>
      toDateString(d) === toDateString(checkInDate)
    );

    // If check-in is before visible range, start from first visible day
    if (startIdx === -1 && startsBeforeRange) {
      startIdx = 0;
    }

    // Still not found? Don't show
    if (startIdx === -1) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }

    // Calculate span from start to check-out (inclusive) or end of visible range
    let span = 0;
    for (let i = startIdx; i < dateRange.length; i++) {
      const currentDate = dateRange[i];
      if (compareDates(currentDate, checkOutDate) <= 0) {
        span++;
      } else {
        break;
      }
    }

    return { start: startIdx, span, startsBeforeRange, endsAfterRange };
  }, [dateRange]);

  // Use turnover_status for reservation block colors
  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-red-400 hover:bg-red-500';
      case 'in_progress':
        return 'bg-yellow-400 hover:bg-yellow-500';
      case 'complete':
        return 'bg-green-400 hover:bg-green-500';
      case 'no_tasks':
        return 'bg-neutral-400 hover:bg-neutral-500';
      default:
        return 'bg-rose-400 hover:bg-rose-500';
    }
  }, []);

  return {
    // State
    reservations,
    setReservations,
    recurringTasks,
    setRecurringTasks,
    properties,
    loading,
    selectedReservation,
    setSelectedReservation,
    view,
    setView,
    anchorDate,
    dateRange,

    // Actions
    fetchReservations,
    goToPrevious,
    goToNext,
    goToToday,

    // Helpers
    formatDate,
    isToday,
    getReservationsForProperty,
    getBlockPosition,
    getStatusColor,
  };
}
