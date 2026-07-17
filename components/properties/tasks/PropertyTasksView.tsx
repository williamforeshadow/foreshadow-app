'use client';

import { apiFetch } from '@/lib/apiFetch';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { toast } from '@/components/ui/toast';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { emptyDraft, type TaskDetailInput, type TaskDraft } from '@/components/tasks/detail/taskInput';
import type { TaskCreatePayload } from '@/components/tasks/detail/useTaskDetailController';
import { TaskRow, TaskListHeader, type TaskRowItem } from '@/components/tasks/TaskRow';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import { useIsMobile } from '@/lib/useIsMobile';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import {
  TaskFilterBar,
  type SortKey,
  type SortDir,
  type FilterOption,
  ORIGIN_MANUAL,
  ORIGIN_AUTOMATED,
} from '@/components/tasks/TaskFilterBar';
import { taskPath } from '@/src/lib/links';
import { fetchJson, qk } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';

// Property Tasks ledger — shows every task ever linked to the property.
// Curation is done by the user via filter + sort, not by the component. The
// main list renders tasks grouped by scheduled date (Overdue / Today / This
// week / Later / No date / Completed), with a right-side 1/3 detail panel
// that matches the Projects kanban detail width.

// ---- Types ----------------------------------------------------------------

const EMPTY_RAW_TASKS: RawTask[] = [];

interface RawTask {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string | null;
  // description can be either a legacy plain-text string or a Tiptap JSON doc;
  // we keep it loose here and let the detail panel figure it out (same as
  // MyAssignmentsWindow, which treats raw as `any`).
  description: any;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  is_automated: boolean;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  assigned_users: {
    user_id: string;
    name: string;
    avatar: string | null;
    role: string;
  }[];
  comment_count: number;
}

// Adapt a ledger row (task_id-keyed) into the unified panel's input shape.
// `raw.property_id`/`property_name` fall back to the view's own props since
// this is a property-scoped page (every task here belongs to `propertyId`).
function rawTaskToDetailInput(
  raw: RawTask,
  propertyId: string,
  propertyName: string
): TaskDetailInput {
  return {
    task_id: raw.task_id,
    reservation_id: raw.reservation_id,
    property_id: raw.property_id ?? propertyId,
    property_name: raw.property_name ?? propertyName,
    template_id: raw.template_id,
    template_name: raw.template_name,
    title: raw.title,
    description: raw.description,
    priority: raw.priority,
    department_id: raw.department_id,
    department_name: raw.department_name,
    status: raw.status,
    scheduled_date: raw.scheduled_date,
    scheduled_time: raw.scheduled_time,
    form_metadata: raw.form_metadata,
    bin_id: raw.bin_id,
    bin_name: raw.bin_name,
    is_binned: raw.is_binned,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    assigned_users: raw.assigned_users,
  };
}

interface UnifiedItem extends TaskRowItem {
  raw: RawTask;
  source: 'task';
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface DateGroup {
  id: string;
  label: string;
  sublabel?: string;
  items: UnifiedItem[];
  defaultCollapsed?: boolean;
}

// ---- URL persistence ------------------------------------------------------

const URL_KEYS = {
  search: 'q',
  status: 'status',
  assignee: 'assignee',
  department: 'dept',
  bin: 'bin',
  origin: 'origin',
  sortKey: 'sort',
  sortDir: 'dir',
} as const;

function parseSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').filter(Boolean));
}

function serializeSet(set: Set<string>): string | null {
  return set.size === 0 ? null : Array.from(set).join(',');
}

// ---- Date bucketing -------------------------------------------------------

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function endOfWeekISO(): string {
  const now = new Date();
  const eow = new Date(now);
  const daysUntilSunday = 7 - now.getDay();
  eow.setDate(now.getDate() + daysUntilSunday);
  return `${eow.getFullYear()}-${String(eow.getMonth() + 1).padStart(2, '0')}-${String(eow.getDate()).padStart(2, '0')}`;
}

// ---- Component ------------------------------------------------------------

interface PropertyTasksViewProps {
  propertyId: string;
  propertyName: string;
}

function PropertyTasksViewContent({
  propertyId,
  propertyName,
}: PropertyTasksViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { departments: allDepts } = useDepartments();
  const isMobile = useIsMobile();

  // ---- Filter / sort state (URL-persisted) --------------------------------

  const [search, setSearch] = useState(
    () => searchParams?.get(URL_KEYS.search) || ''
  );
  const [statusSelected, setStatusSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.status) || null)
  );
  const [assigneeSelected, setAssigneeSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.assignee) || null)
  );
  const [departmentSelected, setDepartmentSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.department) || null)
  );
  const [binSelected, setBinSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.bin) || null)
  );
  const [originSelected, setOriginSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.origin) || null)
  );
  const [prioritySelected, setPrioritySelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get('priority') || null)
  );
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const v = searchParams?.get(URL_KEYS.sortKey);
    return v === 'completed' || v === 'created' || v === 'updated' || v === 'priority'
      ? v
      : 'scheduled';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const v = searchParams?.get(URL_KEYS.sortDir);
    return v === 'asc' ? 'asc' : 'desc';
  });

  // Sync state → URL (replace, don't push, so back button isn't polluted).
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set(URL_KEYS.search, search);
    const status = serializeSet(statusSelected);
    if (status) params.set(URL_KEYS.status, status);
    const assignee = serializeSet(assigneeSelected);
    if (assignee) params.set(URL_KEYS.assignee, assignee);
    const dept = serializeSet(departmentSelected);
    if (dept) params.set(URL_KEYS.department, dept);
    const bin = serializeSet(binSelected);
    if (bin) params.set(URL_KEYS.bin, bin);
    const origin = serializeSet(originSelected);
    if (origin) params.set(URL_KEYS.origin, origin);
    const priority = serializeSet(prioritySelected);
    if (priority) params.set('priority', priority);
    if (sortKey !== 'scheduled') params.set(URL_KEYS.sortKey, sortKey);
    if (sortDir !== 'desc') params.set(URL_KEYS.sortDir, sortDir);

    const qs = params.toString();
    const href = qs ? `?${qs}` : window.location.pathname;
    router.replace(href as any, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    search,
    statusSelected,
    assigneeSelected,
    departmentSelected,
    binSelected,
    originSelected,
    prioritySelected,
    sortKey,
    sortDir,
  ]);

  // ---- Data fetch ---------------------------------------------------------

  // Cached property task ledger — revisits paint instantly; mutation handlers
  // call fetchTasks() (now a silent refetch) to reconcile with server truth.
  const tasksQuery = useQuery({
    queryKey: qk.propertyTasks(propertyId),
    queryFn: () =>
      fetchJson<{ tasks?: RawTask[] }>(`/api/properties/${propertyId}/tasks`).then(
        (d) => d.tasks ?? []
      ),
  });
  const rawTasks = tasksQuery.data ?? EMPTY_RAW_TASKS;
  const loading = tasksQuery.isLoading;
  const error = tasksQuery.error
    ? tasksQuery.error.message || 'Failed to fetch tasks'
    : null;
  const { refetch: refetchTasks } = tasksQuery;
  const fetchTasks = useCallback(async () => {
    await refetchTasks();
  }, [refetchTasks]);

  // ---- Derived: unified items, filter options ---------------------------

  const allItems: UnifiedItem[] = useMemo(() => {
    return rawTasks.map((task) => ({
      key: `task-${task.task_id}`,
      source: 'task' as const,
      title: task.title || task.template_name || 'Untitled Task',
      property_name: task.property_name || propertyName,
      status: task.status || 'not_started',
      priority: task.priority || 'medium',
      department_id: task.department_id,
      department_name: task.department_name,
      scheduled_date: task.scheduled_date,
      scheduled_time: task.scheduled_time,
      assignees: task.assigned_users.map((u) => ({
        user_id: u.user_id,
        name: u.name,
        avatar: u.avatar,
      })),
      bin_id: task.bin_id,
      bin_name: task.bin_name,
      is_binned: task.is_binned,
      is_automated: task.is_automated,
      reservation_id: task.reservation_id,
      comment_count: task.comment_count ?? 0,
      completed_at: task.completed_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
      raw: task,
    }));
  }, [rawTasks, propertyName]);

  // Filter option lists (computed from the full set so users can discover all
  // available values even if their current filter hides them).
  const statusOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i) => {
      counts[i.status] = (counts[i.status] || 0) + 1;
    });
    return [
      { value: 'not_started', label: 'Not started', count: counts.not_started },
      { value: 'in_progress', label: 'In progress', count: counts.in_progress },
      { value: 'paused', label: 'Paused', count: counts.paused },
      { value: 'complete', label: 'Complete', count: counts.complete },
    ].filter((o) => (o.count ?? 0) > 0 || true);
  }, [allItems]);

  const assigneeOptions: FilterOption[] = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    allItems.forEach((i) => {
      i.assignees.forEach((a) => {
        const existing = seen.get(a.user_id);
        seen.set(a.user_id, {
          name: a.name,
          count: (existing?.count || 0) + 1,
        });
      });
    });
    return Array.from(seen.entries())
      .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allItems]);

  const departmentOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i) => {
      if (i.department_id) {
        counts[i.department_id] = (counts[i.department_id] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([id, count]) => ({
        value: id,
        label: allDepts.find((d) => d.id === id)?.name || 'Unknown dept',
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allItems, allDepts]);

  // Bin filter options (mirrors the Bins page taxonomy; no "all bins"
  // sentinel — the chip's "Select All" action achieves the same effect):
  //   1. Task Bin     (__task_bin__)      — orphan binned (is_binned=true AND bin_id IS NULL)
  //   2. Sub-bins, each counted by bin_id — under the "Sub-Bins" group header
  //   3. Not binned   (__none__)          — under the "Other" group header,
  //                                          visually separated so the user
  //                                          can tell it's not a bin
  const binOptions: FilterOption[] = useMemo(() => {
    const namedCounts: Record<string, { name: string; count: number }> = {};
    let notBinnedCount = 0;
    let taskBinCount = 0;
    allItems.forEach((i) => {
      if (!i.is_binned) {
        notBinnedCount++;
        return;
      }
      if (i.bin_id) {
        const existing = namedCounts[i.bin_id];
        namedCounts[i.bin_id] = {
          name: i.bin_name || 'Sub-Bin',
          count: (existing?.count || 0) + 1,
        };
      } else {
        taskBinCount++;
      }
    });
    return [
      { value: '__task_bin__', label: 'Task Bin', count: taskBinCount },
      ...Object.entries(namedCounts)
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count, group: 'Sub-Bins' }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: '__none__', label: 'Not binned', count: notBinnedCount, group: 'Other' },
    ];
  }, [allItems]);

  // Origin filter options. Empty set == both selected == "no filter".
  const originOptions: FilterOption[] = useMemo(() => {
    let manual = 0;
    let automated = 0;
    allItems.forEach((i) => {
      if (i.is_automated) automated++;
      else manual++;
    });
    return [
      { value: ORIGIN_MANUAL, label: 'Manual', count: manual },
      { value: ORIGIN_AUTOMATED, label: 'Automated', count: automated },
    ];
  }, [allItems]);

  const priorityOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i) => {
      counts[i.priority] = (counts[i.priority] || 0) + 1;
    });
    return [
      { value: 'urgent', label: 'Urgent', count: counts.urgent || 0 },
      { value: 'high', label: 'High', count: counts.high || 0 },
      { value: 'medium', label: 'Medium', count: counts.medium || 0 },
      { value: 'low', label: 'Low', count: counts.low || 0 },
    ];
  }, [allItems]);

  // ---- Filter + sort ------------------------------------------------------

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (q) {
        const hay = `${item.title} ${item.raw.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusSelected.size > 0 && !statusSelected.has(item.status)) return false;

      if (departmentSelected.size > 0) {
        if (!item.department_id || !departmentSelected.has(item.department_id)) return false;
      }

      if (assigneeSelected.size > 0) {
        if (!item.assignees.some((a) => assigneeSelected.has(a.user_id))) return false;
      }

      if (binSelected.size > 0) {
        const matches = Array.from(binSelected).some((val) => {
          if (val === '__none__') return !item.is_binned;
          // Task Bin = orphan binned (binned but no specific sub-bin).
          if (val === '__task_bin__') return item.is_binned && !item.bin_id;
          return item.bin_id === val;
        });
        if (!matches) return false;
      }

      // Origin: empty set OR both values selected == no filter. Exactly one
      // selection narrows to manual- or automated-only.
      if (originSelected.size === 1) {
        const wantAutomated = originSelected.has(ORIGIN_AUTOMATED);
        if (wantAutomated !== item.is_automated) return false;
      }

      if (prioritySelected.size > 0 && !prioritySelected.has(item.priority))
        return false;

      return true;
    });
  }, [
    allItems,
    search,
    statusSelected,
    assigneeSelected,
    departmentSelected,
    binSelected,
    originSelected,
    prioritySelected,
  ]);

  const sortedItems = useMemo(() => {
    const arr = [...filteredItems];
    // 'priority' sort uses a numeric ordering (urgent → low) so missing /
    // unknown priorities sort last regardless of direction. All other keys
    // are date strings.
    const PRIORITY_ORDER: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const keyOf = (i: UnifiedItem): string | number => {
      switch (sortKey) {
        case 'completed':
          return i.completed_at || '';
        case 'created':
          return i.created_at || '';
        case 'updated':
          return i.updated_at || '';
        case 'priority':
          return PRIORITY_ORDER[i.priority] ?? 99;
        case 'scheduled':
        default:
          return `${i.scheduled_date || ''}T${i.scheduled_time || ''}`;
      }
    };
    arr.sort((a, b) => {
      const av = keyOf(a);
      const bv = keyOf(b);
      const aEmpty = av === '' || av === 99;
      const bEmpty = bv === '' || bv === 99;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      if (aEmpty && bEmpty) return 0;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sortKey, sortDir]);

  // ---- Grouping (respects the current sort; completed goes to own group) --

  const groups = useMemo((): DateGroup[] => {
    const today = todayISO();
    const eow = endOfWeekISO();

    const overdue: UnifiedItem[] = [];
    const todayBucket: UnifiedItem[] = [];
    const thisWeek: UnifiedItem[] = [];
    const later: UnifiedItem[] = [];
    const unscheduled: UnifiedItem[] = [];
    const completed: UnifiedItem[] = [];

    for (const item of sortedItems) {
      if (item.status === 'complete') {
        completed.push(item);
        continue;
      }
      const d = item.scheduled_date;
      if (!d) unscheduled.push(item);
      else if (d < today) overdue.push(item);
      else if (d === today) todayBucket.push(item);
      else if (d <= eow) thisWeek.push(item);
      else later.push(item);
    }

    const out: DateGroup[] = [];
    if (overdue.length)
      out.push({ id: 'overdue', label: 'Overdue', sublabel: `${overdue.length}`, items: overdue });
    if (todayBucket.length)
      out.push({
        id: 'today',
        label: 'Today',
        sublabel: `${todayBucket.length} scheduled`,
        items: todayBucket,
      });
    if (thisWeek.length)
      out.push({
        id: 'thisWeek',
        label: 'This week',
        sublabel: `${thisWeek.length} scheduled`,
        items: thisWeek,
      });
    if (later.length)
      out.push({ id: 'later', label: 'Later', sublabel: `${later.length} scheduled`, items: later });
    if (unscheduled.length)
      out.push({ id: 'noDate', label: 'No date', sublabel: `${unscheduled.length}`, items: unscheduled });
    if (completed.length)
      out.push({
        id: 'completed',
        label: 'Completed',
        sublabel: `${completed.length}`,
        items: completed,
        defaultCollapsed: true,
      });
    return out;
  }, [sortedItems]);

  const anyFilterActive = useMemo(
    () =>
      !!search ||
      statusSelected.size > 0 ||
      assigneeSelected.size > 0 ||
      departmentSelected.size > 0 ||
      binSelected.size > 0 ||
      // Only count origin as active when it actually narrows results.
      // Empty set or both values selected = pass-through, so no chip
      // highlight and no "clear" required.
      originSelected.size === 1 ||
      prioritySelected.size > 0,
    [
      search,
      statusSelected,
      assigneeSelected,
      departmentSelected,
      binSelected,
      originSelected,
      prioritySelected,
    ]
  );

  const clearAll = useCallback(() => {
    setSearch('');
    setStatusSelected(new Set());
    setAssigneeSelected(new Set());
    setDepartmentSelected(new Set());
    setBinSelected(new Set());
    setOriginSelected(new Set());
    setPrioritySelected(new Set());
  }, []);

  // Collapsible section state. "Completed" starts collapsed; user toggles are
  // keyed by group.id and remembered for the session.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(['completed'])
  );
  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- Detail panel wiring (mirrors MyAssignmentsWindow pattern) ---------

  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [draftTask, setDraftTask] = useState<TaskDraft | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  // Strict single-panel rule (both directions):
  //   global → local: close our locals when context overlays open
  //   local → global: call closeGlobals() before opening any local panel
  //                   so the new local doesn't render behind a still-open
  //                   context overlay (same z-20 slot).
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setSelectedItem(null);
    setDraftTask(null);
  });

  // Adapt the current selection into the unified panel's input shape. The
  // panel is fully self-contained (comments/attachments/timers/templates/
  // bins/saves all live inside it, keyed on task_id + updated_at), so no
  // local mirroring of the row is needed here — `fetchTasks` (via the
  // panel's own cache invalidation) keeps the list in sync.
  const taskDetailInput: TaskDetailInput | null = useMemo(
    () => (selectedItem ? rawTaskToDetailInput(selectedItem.raw, propertyId, propertyName) : null),
    [selectedItem, propertyId, propertyName]
  );

  // ---- New task (draft → POST) -------------------------------------------
  // This page is property-scoped, so the draft's property is locked to the
  // view's own propertyId/propertyName from the start.

  const handleNewTask = useCallback((prefilledDate?: string) => {
    closeGlobals();
    setSelectedItem(null);
    setDraftTask(
      emptyDraft({
        title: 'New Task',
        property_id: propertyId,
        property_name: propertyName,
        scheduled_date: prefilledDate ?? null,
      })
    );
  }, [propertyId, propertyName, closeGlobals]);

  // The Schedule tab's DayDetailPanel deep-links "New task" here by pushing
  // `?newTaskDate=YYYY-MM-DD`. We pop the draft with that date pre-filled
  // and strip the param so a refresh doesn't re-open the draft.
  useEffect(() => {
    const prefilled = searchParams?.get('newTaskDate');
    if (!prefilled) return;
    handleNewTask(prefilled);
    const current = new URLSearchParams(searchParams?.toString() || '');
    current.delete('newTaskDate');
    const next = current.toString();
    router.replace(
      next ? `?${next}` : `/properties/${propertyId}/tasks`,
      { scroll: false }
    );
    // Intentionally run only when the query param appears (or changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.get('newTaskDate')]);

  // Draft create — property is fixed (this page IS the property), so it's
  // sourced from the view's own props rather than the (locked) draft fields.
  const handleConfirmCreateTask = useCallback(
    async (payload: TaskCreatePayload) => {
      setCreatingTask(true);
      try {
        const body: Record<string, unknown> = {
          title: payload.fields.title || 'New Task',
          status: payload.fields.status || 'not_started',
          priority: payload.fields.priority || 'medium',
          is_binned: false,
          description: payload.fields.description ?? null,
          department_id: payload.fields.department_id || null,
          scheduled_date: payload.fields.scheduled_date || null,
          scheduled_time: payload.fields.scheduled_time || null,
          property_id: propertyId,
          property_name: propertyName,
          template_id: payload.template_id || null,
        };
        if (payload.fields.assigned_staff?.length) {
          body.assigned_user_ids = payload.fields.assigned_staff;
        }

        const res = await apiFetch('/api/tasks-for-bin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json().catch(() => ({}));
        if (result.data) {
          setDraftTask(null);
          await fetchTasks();
        } else {
          console.error('Create failed:', result.error);
          toast.error(result?.error || "Couldn't create the task");
        }
      } catch (err) {
        console.error('Error creating task:', err);
        toast.error("Couldn't create the task");
      } finally {
        setCreatingTask(false);
      }
    },
    [propertyId, propertyName, fetchTasks]
  );

  const openCount = useMemo(
    () => allItems.filter((i) => i.status !== 'complete').length,
    [allItems]
  );

  const detailOpen = selectedItem != null || draftTask != null;

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* List side — full-width when no detail; 2/3 when detail is open on
          desktop (the detail panel renders as an absolute overlay on the
          outer `/properties` column, anchored by app/properties/layout.tsx
          → `relative`, so it spans from the viewport top past the
          property header). On mobile the detail panel is a full-screen
          sheet, so the list stays at full width underneath. */}
      <div
        className={`${!isMobile && detailOpen ? 'w-2/3' : 'w-full'} flex flex-col min-w-0 transition-all`}
      >
        {/* Header + filters */}
        <div className="flex-shrink-0 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
          <TaskFilterBar
            search={search}
            onSearchChange={setSearch}
            statusOptions={statusOptions}
            statusSelected={statusSelected}
            onStatusChange={setStatusSelected}
            assigneeOptions={assigneeOptions}
            assigneeSelected={assigneeSelected}
            onAssigneeChange={setAssigneeSelected}
            departmentOptions={departmentOptions}
            departmentSelected={departmentSelected}
            onDepartmentChange={setDepartmentSelected}
            binOptions={binOptions}
            binSelected={binSelected}
            onBinChange={setBinSelected}
            originOptions={originOptions}
            originSelected={originSelected}
            onOriginChange={setOriginSelected}
            priorityOptions={priorityOptions}
            prioritySelected={prioritySelected}
            onPriorityChange={setPrioritySelected}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={(k, d) => {
              setSortKey(k);
              setSortDir(d);
            }}
            onClearAll={clearAll}
            anyFilterActive={anyFilterActive}
            onNewTask={handleNewTask}
            totalCount={allItems.length}
            filteredCount={filteredItems.length}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">{error}</p>
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">
                No tasks for this property yet
              </p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
                Tasks created here or via Hostaway turnovers will appear in this ledger.
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No matches</p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
                No tasks match your current filters.
              </p>
              <button
                onClick={clearAll}
                className="mt-3 text-[12px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)] hover:underline"
              >
                Clear filters
              </button>
              <p className="text-[11px] text-neutral-400 dark:text-[#66645f] mt-2">
                {openCount} open · {allItems.length} total
              </p>
            </div>
          ) : (
            <div className={isMobile ? 'px-5 pb-8' : 'px-8 pb-8'}>
              {/* Column labels are desktop-only — mobile doesn't have the
                  extra assignee/department/bin/comments columns to label. */}
              {!isMobile && (
                <div className="pt-5">
                  <TaskListHeader />
                </div>
              )}
              {groups.map((group) => {
                const isCollapsed = collapsedSections.has(group.id);
                return (
                  <div key={group.id} className="pt-5">
                    <button
                      onClick={() => toggleSection(group.id)}
                      className="flex items-center justify-between w-full mb-3"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${
                            isCollapsed ? '-rotate-90' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
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

                    {!isCollapsed && (
                      <div className="flex flex-col">
                        {group.items.map((item, idx) => {
                          const dept = allDepts.find((d) => d.id === item.department_id);
                          const DeptIcon = getDepartmentIcon(dept?.icon);
                          const isSelected = selectedItem?.key === item.key;
                          const isLast = idx === group.items.length - 1;
                          const handleClick = () => {
                            if (isSelected) {
                              setDraftTask(null);
                              setSelectedItem(null);
                            } else {
                              closeGlobals();
                              setDraftTask(null);
                              setSelectedItem(item);
                            }
                          };
                          if (isMobile) {
                            return (
                              <MobileTaskRow
                                key={item.key}
                                item={item}
                                selected={isSelected}
                                isLast={isLast}
                                onClick={handleClick}
                                hideProperty
                                departmentIcon={DeptIcon}
                              />
                            );
                          }
                          return (
                            <TaskRow
                              key={item.key}
                              item={item}
                              selected={isSelected}
                              isLast={isLast}
                              onClick={handleClick}
                              hideProperty
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

      {/* Detail panel — the unified TaskDetailPanel is fully self-contained
          (comments/attachments/timers/templates/bins/saves all live inside
          it). Mobile self-renders `fixed inset-0`; desktop renders as a
          floating card filling the absolute right-1/3 host slot anchored to
          the outer /properties column. */}
      {detailOpen && (() => {
        const panel = (
          <TaskDetailPanel
            task={taskDetailInput}
            onClose={() => {
              setSelectedItem(null);
              setDraftTask(null);
            }}
            onOpenInPage={
              taskDetailInput
                ? () => {
                    const id = taskDetailInput.task_id;
                    setSelectedItem(null);
                    setDraftTask(null);
                    router.push(taskPath(id));
                  }
                : undefined
            }
            onDeleted={() => setSelectedItem(null)}
            draft={draftTask}
            onDraftChange={setDraftTask}
            onConfirmCreate={handleConfirmCreateTask}
            creating={creatingTask}
          />
        );

        if (isMobile) return panel; // panel self-renders fixed inset-0

        return <div className={DESKTOP_DETAIL_PANEL_FLEX}>{panel}</div>;
      })()}
    </div>
  );
}

export const PropertyTasksView = memo(PropertyTasksViewContent);
