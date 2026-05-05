'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  TaskStatus,
  AssignedUser,
  TiptapJSON,
  ProjectFormFields,
} from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

// ============================================================================
// Types
// ============================================================================

// Shape returned by /api/all-tasks. Mirrors /api/properties/[id]/tasks so the
// shared row + detail components can read both interchangeably.
export interface TaskRow {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string;
  template_id: string | null;
  template_name: string;
  title: string | null;
  description: TiptapJSON | null;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: TaskStatus;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  is_automated: boolean;
  is_recurring: boolean;
  // Reservation context (kept for the detail panel; not used by the row).
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  assigned_users: AssignedUser[];
  comment_count: number;
}

export interface TaskSummary {
  total: number;
  not_started: number;
  in_progress: number;
  complete: number;
  by_department: Record<string, number>;
}

export type SortKey =
  | 'scheduled'
  | 'completed'
  | 'created'
  | 'updated'
  | 'priority';
export type SortDir = 'asc' | 'desc';

export interface DateRangeFilter {
  from: string | null;
  to: string | null;
}

export interface TaskFilters {
  search: string;
  statuses: Set<string>;
  assignees: Set<string>;
  departments: Set<string>;
  // Bin selection accepts these sentinels plus concrete sub-bin UUIDs:
  //   '__none__'     — not binned
  //   '__task_bin__' — orphan binned (is_binned=true AND bin_id IS NULL)
  // Plus any number of sub-bin UUIDs. There is no "all bins" sentinel —
  // selecting every binned option (or clearing the selection) achieves
  // the same effect, with the chip's "Select All" action as a shortcut.
  // Mirrors the PropertyTasksView contract.
  bins: Set<string>;
  // Origin: 'manual' (created via New Task) vs 'automated' (turnovers /
  // recurring / templated spawns). Empty set OR both selected = no filter.
  origins: Set<string>;
  priorities: Set<string>;
  // Property filter is the Tasks-tab-only chip — every other surface that
  // shows tasks is already pre-scoped to a property.
  properties: Set<string>;
  scheduledDateRange: DateRangeFilter;
}

export const ORIGIN_MANUAL = 'manual';
export const ORIGIN_AUTOMATED = 'automated';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const DEFAULT_FILTERS: TaskFilters = {
  search: '',
  statuses: new Set(),
  assignees: new Set(),
  departments: new Set(),
  bins: new Set(),
  origins: new Set(),
  priorities: new Set(),
  properties: new Set(),
  scheduledDateRange: { from: null, to: null },
};

const DEFAULT_SORT: { key: SortKey; dir: SortDir } = {
  key: 'scheduled',
  dir: 'asc',
};

const STORAGE_KEY = 'tasks-window:state:v1';

// ============================================================================
// URL serialization helpers
// ============================================================================

const URL_KEYS = {
  search: 'q',
  status: 'status',
  assignee: 'assignee',
  department: 'dept',
  bin: 'bin',
  origin: 'origin',
  priority: 'priority',
  property: 'property',
  schedFrom: 'schedFrom',
  schedTo: 'schedTo',
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

function isSortKey(v: string | null | undefined): v is SortKey {
  return (
    v === 'scheduled' ||
    v === 'completed' ||
    v === 'created' ||
    v === 'updated' ||
    v === 'priority'
  );
}

function readFromParams(
  params: URLSearchParams | null
): { filters: TaskFilters; sort: { key: SortKey; dir: SortDir } } | null {
  if (!params) return null;
  const hasAny =
    params.has(URL_KEYS.search) ||
    params.has(URL_KEYS.status) ||
    params.has(URL_KEYS.assignee) ||
    params.has(URL_KEYS.department) ||
    params.has(URL_KEYS.bin) ||
    params.has(URL_KEYS.origin) ||
    params.has(URL_KEYS.priority) ||
    params.has(URL_KEYS.property) ||
    params.has(URL_KEYS.schedFrom) ||
    params.has(URL_KEYS.schedTo) ||
    params.has(URL_KEYS.sortKey) ||
    params.has(URL_KEYS.sortDir);
  if (!hasAny) return null;
  return {
    filters: {
      search: params.get(URL_KEYS.search) || '',
      statuses: parseSet(params.get(URL_KEYS.status)),
      assignees: parseSet(params.get(URL_KEYS.assignee)),
      departments: parseSet(params.get(URL_KEYS.department)),
      bins: parseSet(params.get(URL_KEYS.bin)),
      origins: parseSet(params.get(URL_KEYS.origin)),
      priorities: parseSet(params.get(URL_KEYS.priority)),
      properties: parseSet(params.get(URL_KEYS.property)),
      scheduledDateRange: {
        from: params.get(URL_KEYS.schedFrom),
        to: params.get(URL_KEYS.schedTo),
      },
    },
    sort: {
      key: isSortKey(params.get(URL_KEYS.sortKey))
        ? (params.get(URL_KEYS.sortKey) as SortKey)
        : DEFAULT_SORT.key,
      dir: params.get(URL_KEYS.sortDir) === 'desc' ? 'desc' : 'asc',
    },
  };
}

function writeFiltersToParams(
  params: URLSearchParams,
  filters: TaskFilters,
  sort: { key: SortKey; dir: SortDir }
) {
  // Clear our keys first so we don't leak previous values.
  Object.values(URL_KEYS).forEach((k) => params.delete(k));

  if (filters.search) params.set(URL_KEYS.search, filters.search);
  const status = serializeSet(filters.statuses);
  if (status) params.set(URL_KEYS.status, status);
  const assignee = serializeSet(filters.assignees);
  if (assignee) params.set(URL_KEYS.assignee, assignee);
  const dept = serializeSet(filters.departments);
  if (dept) params.set(URL_KEYS.department, dept);
  const bin = serializeSet(filters.bins);
  if (bin) params.set(URL_KEYS.bin, bin);
  const origin = serializeSet(filters.origins);
  if (origin) params.set(URL_KEYS.origin, origin);
  const priority = serializeSet(filters.priorities);
  if (priority) params.set(URL_KEYS.priority, priority);
  const property = serializeSet(filters.properties);
  if (property) params.set(URL_KEYS.property, property);
  if (filters.scheduledDateRange.from)
    params.set(URL_KEYS.schedFrom, filters.scheduledDateRange.from);
  if (filters.scheduledDateRange.to)
    params.set(URL_KEYS.schedTo, filters.scheduledDateRange.to);
  if (sort.key !== DEFAULT_SORT.key) params.set(URL_KEYS.sortKey, sort.key);
  if (sort.dir !== DEFAULT_SORT.dir) params.set(URL_KEYS.sortDir, sort.dir);
}

// ============================================================================
// Persistence helpers (localStorage as the "restore on visit-with-empty-params"
// fallback, mirroring Linear / Notion behaviour)
// ============================================================================

interface PersistedShape {
  filters: {
    search: string;
    statuses: string[];
    assignees: string[];
    departments: string[];
    bins: string[];
    origins: string[];
    priorities: string[];
    properties: string[];
    scheduledDateRange: DateRangeFilter;
  };
  sort: { key: SortKey; dir: SortDir };
}

function readFromStorage(): {
  filters: TaskFilters;
  sort: { key: SortKey; dir: SortDir };
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    return {
      filters: {
        search: parsed.filters.search || '',
        statuses: new Set(parsed.filters.statuses || []),
        assignees: new Set(parsed.filters.assignees || []),
        departments: new Set(parsed.filters.departments || []),
        bins: new Set(parsed.filters.bins || []),
        origins: new Set(parsed.filters.origins || []),
        priorities: new Set(parsed.filters.priorities || []),
        properties: new Set(parsed.filters.properties || []),
        scheduledDateRange: parsed.filters.scheduledDateRange || {
          from: null,
          to: null,
        },
      },
      sort: {
        key: isSortKey(parsed.sort?.key) ? parsed.sort.key : DEFAULT_SORT.key,
        dir: parsed.sort?.dir === 'desc' ? 'desc' : 'asc',
      },
    };
  } catch {
    return null;
  }
}

function writeToStorage(
  filters: TaskFilters,
  sort: { key: SortKey; dir: SortDir }
) {
  if (typeof window === 'undefined') return;
  try {
    const shape: PersistedShape = {
      filters: {
        search: filters.search,
        statuses: Array.from(filters.statuses),
        assignees: Array.from(filters.assignees),
        departments: Array.from(filters.departments),
        bins: Array.from(filters.bins),
        origins: Array.from(filters.origins),
        priorities: Array.from(filters.priorities),
        properties: Array.from(filters.properties),
        scheduledDateRange: filters.scheduledDateRange,
      },
      sort,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    // ignore quota / serialization errors
  }
}

// ============================================================================
// Search helpers (Tiptap descriptions are JSON, not strings — extract text)
// ============================================================================

function extractTextFromDescription(desc: unknown): string {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  if (typeof desc !== 'object') return '';
  // Tiptap doc shape: { type: 'doc', content: [...] } where each node has
  // either { text } (leaf) or { content: [...] } (inline).
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(desc);
  return out.join(' ');
}

// ============================================================================
// Hook
// ============================================================================

interface UseTasksOptions {
  /**
   * When true, filter / sort changes write to URL search params (via
   * `router.replace`). The hook still hydrates from URL on mount regardless of
   * this flag — a deep link always works. Set this to true only when the
   * Tasks view is the actively-displayed surface; otherwise filter changes
   * would pollute the URL while the user is looking at a different tab.
   */
  urlSync?: boolean;
}

export function useTasks(options: UseTasksOptions = {}) {
  const { urlSync = true } = options;
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---- Data ---------------------------------------------------------------

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Filters / sort (hydrated from URL → storage → defaults) ----------

  const [filters, setFiltersState] = useState<TaskFilters>(() => {
    const fromUrl = readFromParams(searchParams);
    if (fromUrl) return fromUrl.filters;
    const fromStorage = readFromStorage();
    if (fromStorage) return fromStorage.filters;
    return DEFAULT_FILTERS;
  });
  const [sort, setSortState] = useState<{ key: SortKey; dir: SortDir }>(() => {
    const fromUrl = readFromParams(searchParams);
    if (fromUrl) return fromUrl.sort;
    const fromStorage = readFromStorage();
    if (fromStorage) return fromStorage.sort;
    return DEFAULT_SORT;
  });

  // Keep refs to read latest in effect bodies without retriggering them.
  const filtersRef = useRef(filters);
  const sortRef = useRef(sort);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  useEffect(() => {
    sortRef.current = sort;
  }, [sort]);

  // ---- Selection ---------------------------------------------------------

  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);

  // ---- Templates ----------------------------------------------------------

  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);

  // ---- Persistence wiring -------------------------------------------------

  // Always mirror to localStorage so refresh restores even when URL is empty.
  useEffect(() => {
    writeToStorage(filters, sort);
  }, [filters, sort]);

  // URL-sync (optional). The hook gates writes behind `urlSync` so the
  // dashboard's not-currently-active Tasks tab can't pollute the URL.
  useEffect(() => {
    if (!urlSync) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    writeFiltersToParams(params, filters, sort);
    const qs = params.toString();
    const path =
      typeof window !== 'undefined' ? window.location.pathname : '';
    const href = qs ? `${path}?${qs}` : path;
    router.replace(href as any, { scroll: false });
    // searchParams intentionally omitted — we don't want to react to our own
    // writes. Same pattern as PropertyTasksView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, urlSync]);

  // ---- Fetch --------------------------------------------------------------

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/all-tasks');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to fetch tasks');
      setTasks(result.data || []);
      setSummary(result.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ---- Filter option lists (computed from full set so users can discover
  //      values even when they're filtered out) ----------------------------

  const filterOptions = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const assigneeMap = new Map<string, { name: string; count: number }>();
    const deptMap = new Map<string, { name: string; count: number }>();
    const binMap = new Map<string, { name: string; count: number }>();
    const propertyMap = new Map<string, number>();
    const priorityCounts: Record<string, number> = {};
    let manualCount = 0;
    let automatedCount = 0;
    let notBinnedCount = 0;
    // taskBinCount = orphan binned (is_binned=true AND bin_id IS NULL —
    // tasks the user binned without picking a specific sub-bin, owned by
    // the system "Task Bin" row).
    let taskBinCount = 0;

    tasks.forEach((t) => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
      if (t.is_automated) automatedCount++;
      else manualCount++;
      if (t.is_binned) {
        if (t.bin_id) {
          const existing = binMap.get(t.bin_id);
          binMap.set(t.bin_id, {
            name: t.bin_name || 'Sub-Bin',
            count: (existing?.count || 0) + 1,
          });
        } else {
          taskBinCount++;
        }
      } else {
        notBinnedCount++;
      }
      if (t.department_id) {
        const existing = deptMap.get(t.department_id);
        deptMap.set(t.department_id, {
          name: t.department_name || 'Department',
          count: (existing?.count || 0) + 1,
        });
      }
      if (t.property_name) {
        propertyMap.set(t.property_name, (propertyMap.get(t.property_name) || 0) + 1);
      }
      t.assigned_users.forEach((a) => {
        const existing = assigneeMap.get(a.user_id);
        assigneeMap.set(a.user_id, {
          name: a.name || 'Unknown',
          count: (existing?.count || 0) + 1,
        });
      });
    });

    return {
      statuses: [
        { value: 'not_started', label: 'Not started', count: statusCounts.not_started || 0 },
        { value: 'in_progress', label: 'In progress', count: statusCounts.in_progress || 0 },
        { value: 'paused', label: 'Paused', count: statusCounts.paused || 0 },
        { value: 'complete', label: 'Complete', count: statusCounts.complete || 0 },
      ],
      assignees: Array.from(assigneeMap.entries())
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      departments: Array.from(deptMap.entries())
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      // Bin filter shape (mirrors the Bins page taxonomy; no "all bins"
      // sentinel — the chip's "Select All" action achieves the same effect):
      //   1. Task Bin     (__task_bin__)      — orphan binned
      //   2. Sub-Bins     (each <uuid>)       — under the "Sub-Bins" group header
      //   3. Not binned   (__none__)          — under the "Other" group header,
      //                                          visually separated so the user
      //                                          can tell it's not a bin
      // Group-header rendering is driven by FilterOption.group (see TaskFilterBar).
      bins: [
        { value: '__task_bin__', label: 'Task Bin', count: taskBinCount },
        ...Array.from(binMap.entries())
          .map(([id, v]) => ({ value: id, label: v.name, count: v.count, group: 'Sub-Bins' }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        { value: '__none__', label: 'Not binned', count: notBinnedCount, group: 'Other' },
      ],
      origins: [
        { value: ORIGIN_MANUAL, label: 'Manual', count: manualCount },
        { value: ORIGIN_AUTOMATED, label: 'Automated', count: automatedCount },
      ],
      priorities: [
        { value: 'urgent', label: 'Urgent', count: priorityCounts.urgent || 0 },
        { value: 'high', label: 'High', count: priorityCounts.high || 0 },
        { value: 'medium', label: 'Medium', count: priorityCounts.medium || 0 },
        { value: 'low', label: 'Low', count: priorityCounts.low || 0 },
      ],
      properties: Array.from(propertyMap.entries())
        .map(([name, count]) => ({ value: name, label: name, count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [tasks]);

  // ---- Filter + sort ------------------------------------------------------

  const filteredTasks = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const fromDate = filters.scheduledDateRange.from;
    const toDate = filters.scheduledDateRange.to;

    let result = tasks.filter((t) => {
      if (q) {
        const hay = [
          t.title || '',
          t.template_name || '',
          t.property_name || '',
          t.guest_name || '',
          t.department_name || '',
          t.bin_name || '',
          extractTextFromDescription(t.description),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (filters.statuses.size > 0 && !filters.statuses.has(t.status)) return false;

      if (filters.priorities.size > 0 && !filters.priorities.has(t.priority))
        return false;

      if (filters.departments.size > 0) {
        if (!t.department_id || !filters.departments.has(t.department_id))
          return false;
      }

      if (filters.assignees.size > 0) {
        if (!t.assigned_users.some((a) => filters.assignees.has(a.user_id)))
          return false;
      }

      if (filters.properties.size > 0) {
        if (!t.property_name || !filters.properties.has(t.property_name))
          return false;
      }

      if (filters.bins.size > 0) {
        const matches = Array.from(filters.bins).some((val) => {
          if (val === '__none__') return !t.is_binned;
          // Task Bin = orphan binned (binned but no specific sub-bin).
          if (val === '__task_bin__') return t.is_binned && !t.bin_id;
          return t.bin_id === val;
        });
        if (!matches) return false;
      }

      // Origin: empty set OR both selected = no filter; one selection narrows.
      if (filters.origins.size === 1) {
        const wantAutomated = filters.origins.has(ORIGIN_AUTOMATED);
        if (wantAutomated !== t.is_automated) return false;
      }

      if (fromDate || toDate) {
        if (!t.scheduled_date) return false;
        if (fromDate && t.scheduled_date < fromDate) return false;
        if (toDate && t.scheduled_date > toDate) return false;
      }

      return true;
    });

    // Sort. Empty values always last.
    const keyOf = (t: TaskRow): string | number => {
      switch (sort.key) {
        case 'scheduled':
          return `${t.scheduled_date || ''}T${t.scheduled_time || ''}`;
        case 'completed':
          return t.completed_at || '';
        case 'created':
          return t.created_at || '';
        case 'updated':
          return t.updated_at || '';
        case 'priority':
          return PRIORITY_ORDER[t.priority] ?? 99;
      }
    };
    result = [...result].sort((a, b) => {
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
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [tasks, filters, sort]);

  // ---- Filter mutators ---------------------------------------------------

  const setSearch = useCallback((v: string) => {
    setFiltersState((prev) => ({ ...prev, search: v }));
  }, []);

  const setStatuses = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, statuses: next }));
  }, []);
  const setAssignees = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, assignees: next }));
  }, []);
  const setDepartments = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, departments: next }));
  }, []);
  const setBins = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, bins: next }));
  }, []);
  const setOrigins = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, origins: next }));
  }, []);
  const setPriorities = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, priorities: next }));
  }, []);
  const setProperties = useCallback((next: Set<string>) => {
    setFiltersState((prev) => ({ ...prev, properties: next }));
  }, []);
  const setScheduledDateRange = useCallback((next: DateRangeFilter) => {
    setFiltersState((prev) => ({ ...prev, scheduledDateRange: next }));
  }, []);

  const setSort = useCallback((key: SortKey, dir: SortDir) => {
    setSortState({ key, dir });
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  const anyFilterActive = useMemo(
    () =>
      !!filters.search ||
      filters.statuses.size > 0 ||
      filters.assignees.size > 0 ||
      filters.departments.size > 0 ||
      filters.bins.size > 0 ||
      filters.origins.size === 1 ||
      filters.priorities.size > 0 ||
      filters.properties.size > 0 ||
      !!filters.scheduledDateRange.from ||
      !!filters.scheduledDateRange.to,
    [filters]
  );

  // ---- Mutations (optimistic + server fan-out) ---------------------------

  const updateTaskInState = useCallback(
    (taskId: string, updates: Partial<TaskRow>) => {
      setTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, ...updates } : t))
      );
      setSelectedTask((prev) =>
        prev?.task_id === taskId ? { ...prev, ...updates } : prev
      );
    },
    []
  );

  // Fan-out save mirroring PropertyTasksView / MyAssignmentsWindow:
  //   /api/update-task-fields      title, description, priority, department_id
  //   /api/update-task-action      status
  //   /api/update-task-schedule    scheduled_date + scheduled_time
  //   /api/update-task-assignment  assignees
  // Sending status / schedule / assignees through update-task-fields silently
  // drops them server-side, which used to cause the row to flip optimistically
  // then revert on reopen. Calling the right endpoint per axis avoids that.
  const saveTaskFields = useCallback(
    async (taskId: string, fields: ProjectFormFields, original: TaskRow, allUsers: { id: string; name?: string; avatar?: string | null; role?: string }[]) => {
      const oldAssignees = (original.assigned_users || [])
        .map((u) => u.user_id)
        .sort()
        .join(',');
      const newAssignees = (fields.assigned_staff || []).slice().sort().join(',');
      const assigneesChanged = oldAssignees !== newAssignees;

      const fieldUpdates: Record<string, unknown> = {};
      if (fields.title !== (original.title || original.template_name || 'Task'))
        fieldUpdates.title = fields.title;
      if (
        JSON.stringify(fields.description) !==
        JSON.stringify(original.description || null)
      )
        fieldUpdates.description = fields.description;
      if (fields.priority !== (original.priority || 'medium'))
        fieldUpdates.priority = fields.priority;
      if (fields.department_id !== (original.department_id || ''))
        fieldUpdates.department_id = fields.department_id || null;

      const oldStatus = original.status || 'not_started';
      const newStatus = (fields.status || 'not_started') as TaskStatus;
      const statusChanged = newStatus !== oldStatus;

      const oldDate = original.scheduled_date || '';
      const oldTime = original.scheduled_time || '';
      const newDate = fields.scheduled_date || '';
      const newTime = fields.scheduled_time || '';
      const scheduleChanged = newDate !== oldDate || newTime !== oldTime;

      const hasFieldChanges = Object.keys(fieldUpdates).length > 0;
      if (!hasFieldChanges && !assigneesChanged && !statusChanged && !scheduleChanged)
        return;

      // Optimistic local patches
      if (hasFieldChanges) updateTaskInState(taskId, fieldUpdates as Partial<TaskRow>);
      if (statusChanged) updateTaskInState(taskId, { status: newStatus });
      if (scheduleChanged)
        updateTaskInState(taskId, {
          scheduled_date: newDate || null,
          scheduled_time: newTime || null,
        });
      if (assigneesChanged) {
        const nextAssignedUsers: AssignedUser[] = (fields.assigned_staff || []).map(
          (uid) => {
            const u = allUsers.find((x) => x.id === uid);
            if (!u) {
              const existing = (original.assigned_users || []).find(
                (a) => a.user_id === uid
              );
              return (
                existing || { user_id: uid, name: '', avatar: undefined, role: '' }
              );
            }
            return {
              user_id: u.id,
              name: u.name || '',
              avatar: u.avatar || undefined,
              role: u.role || '',
            };
          }
        );
        updateTaskInState(taskId, { assigned_users: nextAssignedUsers });
      }

      try {
        const calls: Promise<Response>[] = [];
        if (hasFieldChanges) {
          calls.push(
            fetch('/api/update-task-fields', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, fields: fieldUpdates }),
            })
          );
        }
        if (statusChanged) {
          calls.push(
            fetch('/api/update-task-action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, action: newStatus }),
            })
          );
        }
        if (scheduleChanged) {
          calls.push(
            fetch('/api/update-task-schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId,
                scheduledDate: newDate || null,
                scheduledTime: newTime || null,
              }),
            })
          );
        }
        if (assigneesChanged) {
          calls.push(
            fetch('/api/update-task-assignment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId,
                userIds: fields.assigned_staff || [],
              }),
            })
          );
        }
        await Promise.all(calls);
      } catch (err) {
        console.error('Error updating task:', err);
      }
    },
    [updateTaskInState]
  );

  // ---- Templates ----------------------------------------------------------

  const fetchTaskTemplate = useCallback(
    async (templateId: string, propertyName?: string) => {
      const cacheKey = propertyName ? `${templateId}__${propertyName}` : templateId;
      if (taskTemplates[cacheKey]) return taskTemplates[cacheKey];
      setLoadingTaskTemplate(templateId);
      try {
        const url = propertyName
          ? `/api/templates/${templateId}?property_name=${encodeURIComponent(propertyName)}`
          : `/api/templates/${templateId}`;
        const res = await fetch(url);
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch template');
        setTaskTemplates((prev) => ({ ...prev, [cacheKey]: result.template }));
        return result.template;
      } catch (err) {
        console.error('Error fetching template:', err);
        return null;
      } finally {
        setLoadingTaskTemplate(null);
      }
    },
    [taskTemplates]
  );

  const saveTaskForm = useCallback(
    async (taskId: string, formData: Record<string, unknown>) => {
      try {
        const res = await fetch('/api/save-task-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, formData }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to save task form');
        updateTaskInState(taskId, { form_metadata: formData });
        return result;
      } catch (err) {
        console.error('Error saving task form:', err);
        throw err;
      }
    },
    [updateTaskInState]
  );

  return {
    // Data
    tasks: filteredTasks,
    allTasks: tasks,
    summary,
    loading,
    error,
    fetchTasks,

    // Filters
    filters,
    filterOptions,
    setSearch,
    setStatuses,
    setAssignees,
    setDepartments,
    setBins,
    setOrigins,
    setPriorities,
    setProperties,
    setScheduledDateRange,
    clearFilters,
    anyFilterActive,

    // Sort
    sort,
    setSort,

    // Selection
    selectedTask,
    setSelectedTask,

    // Mutations
    updateTaskInState,
    saveTaskFields,

    // Templates
    taskTemplates,
    loadingTaskTemplate,
    fetchTaskTemplate,
    saveTaskForm,
  };
}
