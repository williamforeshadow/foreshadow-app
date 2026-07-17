'use client';

import { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMyAssignments } from '@/lib/queries';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import type { User, Project } from '@/lib/types';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import type { TaskDetailInput } from '@/components/tasks/detail/taskInput';
import { TaskRow, TaskListHeader } from '@/components/tasks/TaskRow';
import {
  TaskFilterBar,
  SortSelect,
  type FilterOption,
  type SortKey,
  type SortDir,
} from '@/components/tasks/TaskFilterBar';
import { CompactSearch } from '@/components/ui/compact-search';
import { Filter as FilterIcon } from 'lucide-react';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { taskPath } from '@/src/lib/links';

const OPEN_TASK_CLEAR_SENTINEL = '__clear_open_task__';

interface Assignee {
  user_id: string;
  name: string;
  avatar: string | null;
  role?: string | null;
}

interface RawAssignmentTask extends Record<string, unknown> {
  task_id: string;
  id?: string | null;
  title?: string | null;
  template_name?: string | null;
  description?: Project['description'];
  status?: string | null;
  priority?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  assigned_users?: Assignee[] | null;
  bin_id?: string | null;
  bin_name?: string | null;
  is_binned?: boolean | null;
  comment_count?: number | string | null;
  reservation_id?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  template_id?: string | null;
  form_metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface UnifiedItem {
  key: string;
  source: 'task' | 'project';
  title: string;
  property_name: string;
  status: string;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  assignees: Assignee[];
  bin_id: string | null;
  bin_name: string | null;
  is_binned: boolean;
  comment_count: number;
  // FK to the linked reservation when present. Drives the small "key"
  // badge next to the row title in <TaskRow> via KeyAffordance.
  reservation_id: string | null;
  raw: RawAssignmentTask;
}

interface DateGroup {
  label: string;
  sublabel?: string;
  items: UnifiedItem[];
}

function getRawTaskId(raw: RawAssignmentTask): string {
  return raw.task_id || raw.id || '';
}

// Adapt a RawAssignmentTask (the /api/my-assignments shape) into the unified
// TaskDetailInput the panel consumes. The endpoint never sends created_at /
// updated_at, so those fall back to '' rather than a fabricated timestamp.
function rawToTaskInput(raw: RawAssignmentTask): TaskDetailInput {
  return {
    task_id: getRawTaskId(raw),
    reservation_id: raw.reservation_id ?? null,
    property_id: raw.property_id ?? null,
    property_name: raw.property_name ?? null,
    template_id: raw.template_id ?? null,
    template_name: raw.template_name ?? null,
    title: raw.title ?? null,
    description: raw.description ?? null,
    priority: raw.priority || 'medium',
    department_id: raw.department_id ?? null,
    department_name: raw.department_name ?? null,
    status: raw.status || 'not_started',
    scheduled_date: raw.scheduled_date ?? null,
    scheduled_time: raw.scheduled_time ?? null,
    form_metadata: raw.form_metadata ?? null,
    bin_id: raw.bin_id ?? null,
    bin_name: raw.bin_name ?? null,
    is_binned: raw.is_binned ?? false,
    created_at: raw.created_at ?? '',
    updated_at: raw.updated_at ?? '',
    assigned_users: (raw.assigned_users || []).map((u) => ({
      user_id: u.user_id,
      name: u.name,
      avatar: u.avatar ?? null,
      role: u.role ?? undefined,
    })),
  };
}

interface MyAssignmentsWindowProps {
  users: User[];
  currentUser: User | null;
}

function MyAssignmentsWindowContent({ currentUser }: MyAssignmentsWindowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { departments: allDepts } = useDepartments();
  // Cached, shared query — mirrors MobileMyAssignmentsView. Refetches keep
  // existing data visible while fresh data loads.
  const {
    rawData,
    loading,
    error: queryError,
    refetch,
  } = useMyAssignments<RawAssignmentTask, unknown>(currentUser?.id);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to fetch assignments'
    : null;
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);

  // Filter pills + search — mirrors the Tasks page pattern. All state lives
  // here; the chip lane is collapsed behind a funnel by default.
  const NO_DEPT = '__no_department__';
  const NO_BIN = '__no_bin__';
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [assigneeSel, setAssigneeSel] = useState<Set<string>>(new Set());
  const [deptSel, setDeptSel] = useState<Set<string>>(new Set());
  const [prioritySel, setPrioritySel] = useState<Set<string>>(new Set());
  const [propSel, setPropSel] = useState<Set<string>>(new Set());
  const [binSel, setBinSel] = useState<Set<string>>(new Set());
  const [scheduledDateRange, setScheduledDateRange] = useState<{ from: string | null; to: string | null }>(
    { from: null, to: null }
  );
  const [sortKey, setSortKey] = useState<SortKey>('scheduled');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSortChange = useCallback((k: SortKey, d: SortDir) => {
    setSortKey(k);
    setSortDir(d);
  }, []);
  // "New Task" routes over to the Tasks workspace view with a sentinel
  // query param. TasksWindow reads it and auto-opens its new-task draft
  // flow on mount — the assignments page doesn't have its own create flow,
  // so this hands off to the canonical surface that does.
  const handleNewTask = useCallback(() => {
    router.push('/?view=tasks&newTask=1');
  }, [router]);
  const clearAllAssignmentFilters = useCallback(() => {
    setSearch('');
    setStatusSel(new Set());
    setAssigneeSel(new Set());
    setDeptSel(new Set());
    setPrioritySel(new Set());
    setPropSel(new Set());
    setBinSel(new Set());
    setScheduledDateRange({ from: null, to: null });
  }, []);
  const anyAssignmentFilterActive =
    !!search.trim() ||
    statusSel.size +
      assigneeSel.size +
      deptSel.size +
      prioritySel.size +
      propSel.size +
      binSel.size >
      0 ||
    !!scheduledDateRange.from ||
    !!scheduledDateRange.to;
  const openTaskParam = searchParams?.get('openTask') ?? null;
  const pendingOpenTaskParamRef = useRef<string | null>(null);

  const setOpenTaskParam = useCallback((taskId: string | null) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (taskId) {
      params.set('openTask', taskId);
    } else {
      params.delete('openTask');
    }
    const query = params.toString();
    router.replace(query ? `/assignments?${query}` : '/assignments', { scroll: false });
  }, [router, searchParams]);

  const closeSelectedItem = useCallback(() => {
    pendingOpenTaskParamRef.current = openTaskParam
      ? OPEN_TASK_CLEAR_SENTINEL
      : null;
    setSelectedItem(null);
    setOpenTaskParam(null);
  }, [openTaskParam, setOpenTaskParam]);

  // Strict single-panel rule (both directions):
  //   global → local: close our local panel when context overlays open
  //   local → global: call closeGlobals() before opening our panel so it
  //                   doesn't render behind a still-open context overlay.
  const closeGlobals = useExclusiveDetailPanelHost(closeSelectedItem);

  const openAssignmentItem = useCallback(
    (item: UnifiedItem, { syncUrl = true }: { syncUrl?: boolean } = {}) => {
      const id = getRawTaskId(item.raw);
      closeGlobals();
      setSelectedItem(item);
      if (syncUrl && id) {
        pendingOpenTaskParamRef.current = id;
        setOpenTaskParam(id);
      }
    },
    [closeGlobals, setOpenTaskParam]
  );

  // Update selectedItem.raw locally for instant UI feedback — the panel owns
  // its own display once open, but this keeps the row identity fresh for
  // re-derivation (e.g. re-opening the same item) ahead of the query
  // invalidation the panel already triggers on every save.
  const updateSelectedRaw = useCallback((patch: Record<string, unknown>) => {
    setSelectedItem(prev => {
      if (!prev) return prev;
      return { ...prev, raw: { ...prev.raw, ...patch } };
    });
  }, []);

  // Refetch shim — the query owns the mount fetch; callers use this after
  // mutations to reconcile with server truth.
  const fetchAssignments = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Unify items
  const items = useMemo((): UnifiedItem[] => {
    if (!rawData) return [];
    const result: UnifiedItem[] = [];
    for (const task of rawData.tasks) {
      result.push({
        key: `task-${task.task_id}`,
        source: 'task',
        title: task.title || task.template_name || 'Unnamed Task',
        property_name: task.property_name || '',
        status: task.status || 'not_started',
        priority: task.priority || 'medium',
        department_id: task.department_id || null,
        department_name: task.department_name || null,
        scheduled_date: task.scheduled_date,
        scheduled_time: task.scheduled_time,
        assignees: (task.assigned_users || []).map((u: Assignee) => ({
          user_id: u.user_id,
          name: u.name || 'Unknown',
          avatar: u.avatar || null,
        })),
        bin_id: task.bin_id || null,
        bin_name: task.bin_name || null,
        is_binned: !!task.is_binned,
        comment_count: Number(task.comment_count ?? 0),
        reservation_id: task.reservation_id ?? null,
        raw: task,
      });
    }
    return result;
  }, [rawData]);

  const selectedTaskIdForUrl = selectedItem ? getRawTaskId(selectedItem.raw) : null;
  const selectedItemKey = selectedItem?.key ?? null;

  useEffect(() => {
    const pendingOpenTaskParam = pendingOpenTaskParamRef.current;

    if (pendingOpenTaskParam === OPEN_TASK_CLEAR_SENTINEL) {
      if (!openTaskParam) {
        pendingOpenTaskParamRef.current = null;
      }
      return;
    }

    if (!openTaskParam || loading || !rawData) return;

    if (pendingOpenTaskParam) {
      if (openTaskParam === pendingOpenTaskParam) {
        pendingOpenTaskParamRef.current = null;
      } else if (selectedTaskIdForUrl === pendingOpenTaskParam) {
        return;
      }
    }

    const match = items.find((item) => {
      const id = getRawTaskId(item.raw);
      return id === openTaskParam;
    });

    if (!match) {
      setOpenTaskParam(null);
      return;
    }

    if (selectedItemKey !== match.key) {
      openAssignmentItem(match, { syncUrl: false });
    }
  }, [
    openTaskParam,
    loading,
    rawData,
    items,
    selectedItemKey,
    selectedTaskIdForUrl,
    openAssignmentItem,
    setOpenTaskParam,
  ]);

  // ── Filter chip options (derived from `items`) ────────────────────────
  // Assignees here means *co-assignees* — every row is assigned to the
  // current user, but tasks can be shared. Filtering by a co-assignee is
  // useful to narrow to "tasks I'm working on with X".
  const assignmentFilterOptions = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const deptMap = new Map<string, { name: string; count: number }>();
    const propertyMap = new Map<string, number>();
    const binMap = new Map<string, { name: string; count: number }>();
    const assigneeMap = new Map<string, { name: string; count: number }>();
    let noDeptCount = 0;
    let noBinCount = 0;
    items.forEach((t) => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
      if (t.department_id) {
        const ex = deptMap.get(t.department_id);
        deptMap.set(t.department_id, {
          name: t.department_name || 'Department',
          count: (ex?.count || 0) + 1,
        });
      } else {
        noDeptCount++;
      }
      if (t.property_name) {
        propertyMap.set(t.property_name, (propertyMap.get(t.property_name) || 0) + 1);
      }
      if (t.bin_id) {
        const ex = binMap.get(t.bin_id);
        binMap.set(t.bin_id, {
          name: t.bin_name || 'Bin',
          count: (ex?.count || 0) + 1,
        });
      } else {
        noBinCount++;
      }
      (t.assignees || []).forEach((a) => {
        const ex = assigneeMap.get(a.user_id);
        assigneeMap.set(a.user_id, {
          name: a.name || 'Unknown',
          count: (ex?.count || 0) + 1,
        });
      });
    });
    const statuses: FilterOption[] = [
      { value: 'not_started', label: 'Not started', count: statusCounts.not_started || 0 },
      { value: 'in_progress', label: 'In progress', count: statusCounts.in_progress || 0 },
      { value: 'paused', label: 'Paused', count: statusCounts.paused || 0 },
      { value: 'complete', label: 'Complete', count: statusCounts.complete || 0 },
    ];
    const priorities: FilterOption[] = [
      { value: 'urgent', label: 'Urgent', count: priorityCounts.urgent || 0 },
      { value: 'high', label: 'High', count: priorityCounts.high || 0 },
      { value: 'medium', label: 'Medium', count: priorityCounts.medium || 0 },
      { value: 'low', label: 'Low', count: priorityCounts.low || 0 },
    ];
    const departmentsOpt: FilterOption[] = [
      ...Array.from(deptMap.entries())
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: NO_DEPT, label: 'No department', count: noDeptCount },
    ];
    const propertiesOpt: FilterOption[] = Array.from(propertyMap.entries())
      .map(([name, count]) => ({ value: name, label: name, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const binsOpt: FilterOption[] = [
      ...Array.from(binMap.entries())
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: NO_BIN, label: 'No bin', count: noBinCount },
    ];
    const assignees: FilterOption[] = Array.from(assigneeMap.entries())
      .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { statuses, priorities, departments: departmentsOpt, propertiesOpt, binsOpt, assignees };
  }, [items]);

  // Apply filter predicate before grouping.
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = scheduledDateRange.from
      ? new Date(scheduledDateRange.from + 'T00:00:00').getTime()
      : null;
    const toMs = scheduledDateRange.to
      ? new Date(scheduledDateRange.to + 'T23:59:59').getTime()
      : null;
    return items.filter((t) => {
      if (q) {
        const hay = [t.title, t.property_name, t.department_name || '', t.bin_name || '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusSel.size > 0 && !statusSel.has(t.status)) return false;
      if (assigneeSel.size > 0) {
        const has = (t.assignees || []).some((a) => assigneeSel.has(a.user_id));
        if (!has) return false;
      }
      if (prioritySel.size > 0 && !prioritySel.has(t.priority || '')) return false;
      if (deptSel.size > 0) {
        const key = t.department_id || NO_DEPT;
        if (!deptSel.has(key)) return false;
      }
      if (propSel.size > 0) {
        if (!t.property_name || !propSel.has(t.property_name)) return false;
      }
      if (binSel.size > 0) {
        const key = t.bin_id || NO_BIN;
        if (!binSel.has(key)) return false;
      }
      if (fromMs !== null || toMs !== null) {
        if (!t.scheduled_date) return false;
        const ts = new Date(t.scheduled_date).getTime();
        if (fromMs !== null && ts < fromMs) return false;
        if (toMs !== null && ts > toMs) return false;
      }
      return true;
    });
  }, [items, search, statusSel, assigneeSel, prioritySel, deptSel, propSel, binSel, scheduledDateRange]);

  // Group by date
  const { groups, openCount } = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const endOfWeek = new Date(now);
    const daysUntilSunday = 7 - now.getDay();
    endOfWeek.setDate(now.getDate() + daysUntilSunday);
    const endOfWeekStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, '0')}-${String(endOfWeek.getDate()).padStart(2, '0')}`;

    const overdue: UnifiedItem[] = [];
    const today: UnifiedItem[] = [];
    const thisWeek: UnifiedItem[] = [];
    const later: UnifiedItem[] = [];
    const unscheduled: UnifiedItem[] = [];
    let open = 0;

    for (const item of filteredItems) {
      if (item.status === 'complete') continue;
      open++;
      const d = item.scheduled_date;
      if (!d) {
        unscheduled.push(item);
      } else if (d === todayStr) {
        today.push(item);
      } else if (d > todayStr && d <= endOfWeekStr) {
        thisWeek.push(item);
      } else if (d > endOfWeekStr) {
        later.push(item);
      } else {
        overdue.push(item);
      }
    }

    // Within-group sort obeys the user's SortKey/SortDir selection. The
    // outer grouping (overdue / today / this week / later / no date) is
    // structural and not user-configurable from the Sort pill.
    const statusOrder: Record<string, number> = { in_progress: 0, paused: 1, not_started: 2 };
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const compareItems = (a: UnifiedItem, b: UnifiedItem): number => {
      let cmp = 0;
      switch (sortKey) {
        case 'scheduled': {
          const da = a.scheduled_date || '';
          const db = b.scheduled_date || '';
          cmp = da.localeCompare(db);
          if (cmp === 0) {
            cmp = (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
          }
          break;
        }
        case 'created':
          cmp = (a.raw.created_at || '').localeCompare(b.raw.created_at || '');
          break;
        case 'updated':
        case 'completed':
          // No completed_at on UnifiedItem — sort by updated_at as the
          // closest available proxy.
          cmp = (a.raw.updated_at || '').localeCompare(b.raw.updated_at || '');
          break;
        case 'priority':
          cmp = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    };
    overdue.sort(compareItems);
    today.sort(compareItems);
    thisWeek.sort(compareItems);
    later.sort(compareItems);
    // Unscheduled rows can't be sorted by scheduled_date — fall back to
    // status when the user picked that axis.
    unscheduled.sort((a, b) => {
      if (sortKey === 'scheduled') {
        const sa = statusOrder[a.status] ?? 3;
        const sb = statusOrder[b.status] ?? 3;
        return sa - sb;
      }
      return compareItems(a, b);
    });

    const result: DateGroup[] = [];
    if (overdue.length > 0) result.push({ label: 'Overdue', sublabel: `${overdue.length}`, items: overdue });
    if (today.length > 0) result.push({ label: 'Today', sublabel: `${today.length} scheduled`, items: today });
    if (thisWeek.length > 0) result.push({ label: 'This week', sublabel: `${thisWeek.length} scheduled`, items: thisWeek });
    if (later.length > 0) result.push({ label: 'Later', sublabel: `${later.length} scheduled`, items: later });
    if (unscheduled.length > 0) result.push({ label: 'No Date', sublabel: `${unscheduled.length}`, items: unscheduled });

    return { groups: result, openCount: open };
  }, [filteredItems, sortKey, sortDir]);

  const todayFormatted = useMemo(() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'short' });
    const day = now.getDate();
    return `${weekday} · ${month} ${day}`;
  }, []);

  // --- Render ---
  return (
    // List always takes full width; detail panel below floats over the
    // right 1/3 (overlay), matching every other detail panel in the app.
    <div className="relative h-full overflow-hidden">
      {/* Assignment list */}
      <div className="w-full h-full flex flex-col min-w-0">
        {/* Header region — title + controls row. The gradient fades to
            transparent over the content background (bg-white / dark:bg-card
            base), so the header blends seamlessly into the list below. */}
        <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
        {/* Header */}
        <div className="px-8 pt-6 pb-1">
          <h1 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
            My Assignments
          </h1>
        </div>

        {/* Filter bar — mirrors the Tasks page: CompactSearch icon + filter
            funnel + inline chip lane on one row. No Sort / New Task on the
            right since assignments are existing tasks delivered by the
            backend; sort order is governed by the date sections below. */}
        <div className="px-8 pb-4">
          <div className="flex items-center gap-2 flex-nowrap min-w-0">
            <CompactSearch
              value={search}
              onChange={setSearch}
              placeholder="Search assignments…"
            />

            <button
              type="button"
              onClick={() => setFiltersExpanded((v) => !v)}
              title={filtersExpanded ? 'Hide filters' : 'Show filters'}
              aria-pressed={filtersExpanded}
              className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                filtersExpanded || anyAssignmentFilterActive
                  ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                  : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]'
              }`}
            >
              <FilterIcon className="w-4 h-4" />
            </button>

            {filtersExpanded && (
              <TaskFilterBar
                inline
                statusOptions={assignmentFilterOptions.statuses}
                statusSelected={statusSel}
                onStatusChange={setStatusSel}
                // Co-assignee filter — every row is assigned to the current
                // user; this narrows to tasks shared with a specific teammate.
                assigneeOptions={assignmentFilterOptions.assignees}
                assigneeSelected={assigneeSel}
                onAssigneeChange={setAssigneeSel}
                departmentOptions={assignmentFilterOptions.departments}
                departmentSelected={deptSel}
                onDepartmentChange={setDeptSel}
                binOptions={assignmentFilterOptions.binsOpt}
                binSelected={binSel}
                onBinChange={setBinSel}
                priorityOptions={assignmentFilterOptions.priorities}
                prioritySelected={prioritySel}
                onPriorityChange={setPrioritySel}
                propertyOptions={assignmentFilterOptions.propertiesOpt}
                propertySelected={propSel}
                onPropertyChange={setPropSel}
                scheduledDateRange={scheduledDateRange}
                onScheduledDateRangeChange={setScheduledDateRange}
                onClearAll={clearAllAssignmentFilters}
                anyFilterActive={anyAssignmentFilterActive}
                totalCount={items.length}
                filteredCount={filteredItems.length}
              />
            )}

            {/* Right-anchored: Sort + New Task. Always visible regardless of
                whether the filter pills are expanded — matches the Tasks
                page layout. */}
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <SortSelect
                sortKey={sortKey}
                sortDir={sortDir}
                onChange={handleSortChange}
              />
              <button
                onClick={handleNewTask}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--accent-3)] text-white hover:bg-[var(--accent-4)] dark:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] dark:text-[#1a1a1a] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New task
              </button>
            </div>
          </div>
        </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No tasks assigned</p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">You&apos;re all caught up</p>
            </div>
          ) : (
            <div className="px-8 pb-8">
              <div className="pt-5">
                <TaskListHeader />
              </div>
              {groups.map((group) => {
                const isCollapsed = collapsedSections.has(group.label);
                return (
                  <div key={group.label} className="pt-5">
                    {/* Section header */}
                    <button
                      onClick={() => setCollapsedSections(prev => {
                        const next = new Set(prev);
                        if (next.has(group.label)) next.delete(group.label);
                        else next.add(group.label);
                        return next;
                      })}
                      className="flex items-center justify-between w-full mb-3"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        <span className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
                          {group.label}
                        </span>
                      </div>
                      {group.sublabel && (
                        <span className="text-[11px] text-neutral-400 dark:text-[#66645f] tracking-[0.05em] tabular-nums uppercase">
                          {group.sublabel}
                        </span>
                      )}
                    </button>

                    {/* Assignment rows */}
                    {!isCollapsed && (
                      <div className="flex flex-col">
                        {group.items.map((item, idx) => {
                          const dept = allDepts.find(d => d.id === item.department_id);
                          const DeptIcon = getDepartmentIcon(dept?.icon);
                          const isSelected = selectedItem?.key === item.key;
                          return (
                            <TaskRow
                              key={item.key}
                              item={item}
                              selected={isSelected}
                              isLast={idx === group.items.length - 1}
                              onClick={() => {
                                if (isSelected) {
                                  closeSelectedItem();
                                } else {
                                  openAssignmentItem(item);
                                }
                              }}
                              showBinPill
                              departmentIcon={DeptIcon}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedItem && (
        <div className={DESKTOP_DETAIL_PANEL_FLEX}>
          <TaskDetailPanel
            task={rawToTaskInput(selectedItem.raw)}
            onClose={closeSelectedItem}
            onSaved={(row) => updateSelectedRaw({
              title: row.title,
              template_name: row.template_name,
              description: row.description,
              status: row.status,
              priority: row.priority,
              department_id: row.department_id,
              department_name: row.department_name,
              scheduled_date: row.scheduled_date,
              scheduled_time: row.scheduled_time,
              assigned_users: row.assigned_users,
              bin_id: row.bin_id,
              bin_name: row.bin_name,
              is_binned: row.is_binned,
              form_metadata: row.form_metadata,
            })}
            onDeleted={() => {
              closeSelectedItem();
              fetchAssignments();
            }}
            onOpenInPage={() => {
              const id = getRawTaskId(selectedItem.raw);
              closeSelectedItem();
              router.push(taskPath(id));
            }}
          />
        </div>
      )}
    </div>
  );
}

const MyAssignmentsWindow = memo(MyAssignmentsWindowContent);
export default MyAssignmentsWindow;
