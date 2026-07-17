'use client';

import { useState, useCallback, useMemo, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiFetch';
import { qk } from '@/lib/queries/keys';

type TimelineData = {
  reservations: any[];
  recurringTasks: any[];
  blocks: any[];
  properties: string[];
};

const EMPTY: any[] = [];
const EMPTY_PROPS: string[] = [];

// Fetch reservations (turnovers), recurring tasks, blocks, and the active
// property list in parallel, and derive the timeline's four datasets.
async function fetchTimelineData(): Promise<TimelineData> {
  const [turnoversRes, recurringRes, blocksResult, propertiesRes] = await Promise.all([
    apiFetch('/api/turnovers'),
    apiFetch('/api/recurring-tasks'),
    apiFetch('/api/calendar-blocks'),
    // Default excludes inactive. An inactive ("frozen") property shouldn't
    // appear on the schedule even if it still carries recurring tasks,
    // manual blocks, or lingering future reservations.
    apiFetch('/api/properties'),
  ]);

  const turnoversJson = await turnoversRes.json();
  if (!turnoversRes.ok) throw new Error(turnoversJson.error || 'Failed to fetch turnovers');
  const recurringJson = recurringRes.ok ? await recurringRes.json() : { data: [] };

  // Set of active property names. property_name is a DB-enforced mirror of
  // properties.name, so name matching is exact. If the fetch fails we leave
  // this null and fall back to showing everything (prior behavior). Rows
  // with no property (general recurring tasks) are always kept.
  let activeNames: Set<string> | null = null;
  if (propertiesRes.ok) {
    try {
      const pj = await propertiesRes.json();
      activeNames = new Set<string>((pj.properties || []).map((p: any) => p.name));
    } catch {
      /* leave null → unfiltered */
    }
  }
  const isActiveProp = (name: string | null | undefined) =>
    !activeNames || !name || activeNames.has(name);

  const reservations = (turnoversJson.data || []).filter((r: any) =>
    isActiveProp(r.property_name)
  );

  // Transform recurring tasks to match the Task shape
  const recurringTasks = (recurringJson.data || []).map((t: any) => ({
    task_id: t.id,
    template_id: t.template_id,
    template_name: t.templates?.name || 'Unnamed Task',
    title: t.title || null,
    description: t.description || null,
    priority: t.priority || null,
    bin_id: t.bin_id || null,
    is_binned: t.is_binned ?? false,
    department_id: t.department_id || t.templates?.department_id || null,
    department_name: t.departments?.name || null,
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
  })).filter((t: any) => isActiveProp(t.property_name));

  // Calendar blocks (manual/maintenance unavailability — not reservations),
  // fetched via the service-role API route since calendar_blocks is locked
  // down. Shaped like reservations (check_in/check_out) so the timeline's bar
  // positioning works unchanged; noon-local timestamps avoid the UTC-midnight
  // day-shift when getBlockPosition reads local date parts.
  let blocksRows: any[] = [];
  try {
    if (blocksResult.ok) {
      const json = await blocksResult.json();
      blocksRows = json.blocks || [];
    } else {
      console.error('Error fetching calendar blocks:', blocksResult.status);
    }
  } catch (e) {
    console.error('Error parsing calendar blocks:', e);
  }
  const blocks = blocksRows
    .map((b: any) => ({
      id: b.id,
      property_name: b.property_name || null,
      check_in: `${b.start_date}T12:00:00`,
      check_out: `${b.end_date}T12:00:00`,
      note: b.note || null,
      kind: 'block' as const,
    }))
    .filter((b: any) => b.property_name && isActiveProp(b.property_name));

  // Unique properties from turnovers, recurring tasks, AND blocks — so a
  // property with only a block (no turnovers) still gets a timeline row.
  const uniqueProps = Array.from(
    new Set([
      ...reservations.map((r: any) => r.property_name),
      ...recurringTasks.map((t: any) => t.property_name),
      ...blocks.map((b: any) => b.property_name),
    ])
  )
    .filter(Boolean)
    .sort() as string[];

  return { reservations, recurringTasks, blocks, properties: uniqueProps };
}

// Timeline data lives in a shared React Query cache: both timelines (desktop
// TimelineWindow and mobile Schedule tab) share one fetch and paint instantly
// from cache on remount. Navigation state (view/anchor/dateRange) stays
// per-instance so the two surfaces navigate independently.
export function useTimeline() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.timeline, queryFn: fetchTimelineData });
  const { refetch } = query;

  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Start from yesterday
    return today;
  });

  const reservations = query.data?.reservations ?? EMPTY;
  const blocks = query.data?.blocks ?? EMPTY;
  const recurringTasks = query.data?.recurringTasks ?? EMPTY;
  const properties = query.data?.properties ?? EMPTY_PROPS;

  // setState-compatible wrappers over the shared cache, preserving the
  // optimistic-update API TimelineWindow relies on. cancelQueries drops any
  // in-flight background refetch so its (pre-mutation) response can't land
  // after — and silently revert — the optimistic write.
  const patchTimeline = useCallback(
    (field: 'reservations' | 'recurringTasks', action: SetStateAction<any[]>) => {
      queryClient.cancelQueries({ queryKey: qk.timeline });
      queryClient.setQueryData<TimelineData>(qk.timeline, (old) => {
        if (!old) return old;
        const next =
          typeof action === 'function' ? (action as (p: any[]) => any[])(old[field]) : action;
        return { ...old, [field]: next };
      });
    },
    [queryClient]
  );

  const setReservations = useCallback(
    (action: SetStateAction<any[]>) => patchTimeline('reservations', action),
    [patchTimeline]
  );
  const setRecurringTasks = useCallback(
    (action: SetStateAction<any[]>) => patchTimeline('recurringTasks', action),
    [patchTimeline]
  );

  // `silent` accepted for backward compatibility; refetches are always silent
  // now — cached data stays visible while fresh data loads.
  const fetchReservations = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      void opts;
      await refetch();
    },
    [refetch]
  );

  // Generate date range based on view and anchor date. Memoized so its
  // identity is stable between renders — consumers key memos/effects off it.
  const dateRange = useMemo(() => {
    const dates: Date[] = [];
    const numDays = view === 'week' ? 7 : 30;
    for (let i = 0; i < numDays; i++) {
      const date = new Date(anchorDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, [view, anchorDate]);

  // Navigation functions
  const goToPrevious = useCallback(() => {
    const daysToShift = view === 'week' ? 7 : 30;
    setAnchorDate((prev) => {
      const newAnchor = new Date(prev);
      newAnchor.setDate(newAnchor.getDate() - daysToShift);
      return newAnchor;
    });
  }, [view]);

  const goToNext = useCallback(() => {
    const daysToShift = view === 'week' ? 7 : 30;
    setAnchorDate((prev) => {
      const newAnchor = new Date(prev);
      newAnchor.setDate(newAnchor.getDate() + daysToShift);
      return newAnchor;
    });
  }, [view]);

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

  const getBlocksForProperty = useCallback((propertyName: string) => {
    return blocks.filter(b => b.property_name === propertyName);
  }, [blocks]);

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
    blocks,
    recurringTasks,
    setRecurringTasks,
    properties,
    loading: query.isLoading,
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
    getBlocksForProperty,
    getBlockPosition,
    getStatusColor,
  };
}
