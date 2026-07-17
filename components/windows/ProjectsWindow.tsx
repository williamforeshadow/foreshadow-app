'use client';

import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { memo, useCallback, useState, useEffect, useMemo, useRef, type SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import type { ProjectViewMode, ProjectBin } from '@/lib/types';
import { STATUS_LABELS, STATUS_ORDER, PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/types';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { useTaskBinGlobalView } from '@/lib/hooks/useTaskBinGlobalView';
import { useProperties, fetchJson, qk } from '@/lib/queries';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BinPicker } from './projects';
import { ColumnPicker } from './projects/ColumnPicker';
import { ProjectsKanban } from './projects/ProjectsKanban';
import { useDepartments } from '@/lib/departmentsContext';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { useRouter } from 'next/navigation';
import { taskPath } from '@/src/lib/links';
import type { User, Project } from '@/lib/types';
import { Filter as FilterIcon } from 'lucide-react';
import { CompactSearch } from '@/components/ui/compact-search';
import { TaskFilterBar, type FilterOption } from '@/components/tasks/TaskFilterBar';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput, emptyDraft, type TaskDraft, type TaskDetailInput } from '@/components/tasks/detail/taskInput';
import type { TaskCreatePayload } from '@/components/tasks/detail/useTaskDetailController';

// ============================================================================
// View Mode Toggle — compact pill that expands on click
// ============================================================================

const VIEW_MODE_LABELS: Record<ProjectViewMode, string> = {
  property: 'Property',
  status: 'Status',
  priority: 'Priority',
  department: 'Dept',
  assignee: 'Assignee',
};

const ALL_VIEW_MODES: ProjectViewMode[] = ['property', 'status', 'priority', 'department', 'assignee'];

function ViewModeToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: ProjectViewMode;
  setViewMode: (m: ProjectViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Pill aesthetic shared with the schedule-page filter chips. Single-select
  // (one board orientation at a time) — label stays "Boards" with the current
  // mode rendered as a `· summary` tail so the visual matches MultiSelect.
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed]"
      >
        <span>Boards</span>
        <svg className={`w-3 h-3 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[160px] rounded-lg border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#1a1a1a] shadow-lg py-1">
          {ALL_VIEW_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 text-left text-[12px] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] ${
                viewMode === mode
                  ? 'text-[var(--accent-3)] dark:text-[var(--accent-1)] font-medium'
                  : 'text-neutral-700 dark:text-[#f0efed]'
              }`}
            >
              {VIEW_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================

const EMPTY_PROJECTS: Project[] = [];

// Merge a saved/updated TaskDetailInput row (from the unified TaskDetailPanel)
// back onto a Project row, so this window's kanban list + expandedProject
// state stay visually in sync without waiting on the panel's own cache
// invalidation to round-trip.
function mergeRowIntoProject(project: Project, row: TaskDetailInput): Project {
  return {
    ...project,
    title: row.title || project.title,
    description: (row.description as Project['description']) ?? null,
    status: row.status as Project['status'],
    priority: row.priority as Project['priority'],
    department_id: row.department_id,
    department_name: row.department_name,
    scheduled_date: row.scheduled_date,
    scheduled_time: row.scheduled_time,
    bin_id: row.bin_id,
    is_binned: row.is_binned,
    property_id: row.property_id,
    property_name: row.property_name,
    template_id: row.template_id,
    template_name: row.template_name,
    form_metadata: row.form_metadata ?? undefined,
    reservation_id: row.reservation_id,
    updated_at: row.updated_at,
    project_assignments: row.assigned_users.map((u) => ({
      user_id: u.user_id,
      user: { id: u.user_id, name: u.name, avatar: u.avatar ?? undefined, role: u.role } as User,
    })),
  };
}

interface ProjectsWindowProps {
  users: User[];
  currentUser: User | null;
}

function ProjectsWindowContent({ users, currentUser }: ProjectsWindowProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { departments } = useDepartments();
  const binsHook = useProjectBins({ currentUser });

  // Bin navigation state
  // Bin selection (mirrors BinPicker):
  //   null    → Task Bin (orphan binned tasks, bin_id IS NULL by default;
  //             widened to every binned task when the Task Bin's "Global"
  //             toggle is on — see taskBinGlobal below)
  //   <uuid>  → a specific sub-bin
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [selectedBinName, setSelectedBinName] = useState<string>('Task Bin');
  const [showKanban, setShowKanban] = useState(false);

  const { properties: allProperties } = useProperties();

  // Task Bin "Global" toggle. When ON inside the Task Bin view, the kanban
  // widens to every binned task (Task Bin orphans + every sub-bin) by
  // fetching with the internal '__every__' API sentinel. When OFF, only
  // orphan binned tasks render. Persisted in localStorage so the user's
  // preference survives navigation and reloads.
  const taskBinGlobal = useTaskBinGlobalView();

  // Resolve a logical bin selection (`null` = Task Bin, `<uuid>` = sub-bin)
  // to the API's `bin_id` query param. The Task Bin's "Global" toggle, when
  // on, widens the Task Bin fetch to every binned task via the internal
  // '__every__' sentinel. Sub-bin selections are never widened — Global is
  // a Task-Bin-only knob.
  const apiBinIdFor = useCallback(
    (binId: string | null) =>
      binId === null && taskBinGlobal.enabled ? '__every__' : binId,
    [taskBinGlobal.enabled],
  );

  // The bin task list lives in the shared query cache, keyed by the bin the
  // user is looking at (derived from navigation state — selecting a bin just
  // sets state and the key change drives fetching). Previously-visited bins
  // paint instantly from cache; the spinner shows only on a bin's first-ever
  // visit.
  const viewerId = currentUser?.id ?? null;
  const activeApiBinId = showKanban ? apiBinIdFor(selectedBinId) : null;
  const tasksQuery = useQuery({
    queryKey: qk.tasksForBin(activeApiBinId, viewerId),
    enabled: showKanban,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (viewerId) params.set('viewer_user_id', viewerId);
      if (activeApiBinId !== null) params.set('bin_id', activeApiBinId);
      const result = await fetchJson<{ data?: Project[] }>(
        `/api/tasks-for-bin?${params.toString()}`
      );
      return result.data ?? [];
    },
  });
  const tasks = tasksQuery.data ?? EMPTY_PROJECTS;
  const loadingTasks = tasksQuery.isLoading;

  // Preserve the old fetch-failure toast semantic.
  useEffect(() => {
    if (tasksQuery.isError) {
      console.error('Error fetching tasks for bin:', tasksQuery.error);
      toast.error('Couldn\'t load tasks for this bin.');
    }
  }, [tasksQuery.isError, tasksQuery.error]);

  // Optimistic patch for the ACTIVE bin's cached list. cancelQueries drops
  // any in-flight background refetch so its pre-mutation response can't land
  // after — and silently revert — the optimistic write.
  const patchTasks = useCallback(
    (action: SetStateAction<Project[]>) => {
      const key = qk.tasksForBin(activeApiBinId, viewerId);
      queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Project[]>(key, (old) => {
        const prev = old ?? [];
        return typeof action === 'function' ? (action as (p: Project[]) => Project[])(prev) : action;
      });
    },
    [queryClient, activeApiBinId, viewerId]
  );

  // Membership-changing mutations (bin move, dismiss, create, delete) leave
  // OTHER bins' caches stale — notably the Task Bin vs '__every__' views.
  // The active key was already patched, so its refetch is flash-free; hidden
  // keys are marked stale and refetch before their next paint settles.
  const invalidateAllBinLists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks-for-bin'] });
  }, [queryClient]);

  // View mode
  const [viewMode, setViewMode] = useState<ProjectViewMode>('status');
  const [kanbanSelectionMode, setKanbanSelectionMode] = useState(false);

  // Task-filter state (mirrors the Schedule page's filter axes, plus a
  // Scheduled date-range borrowed from the Tasks page). All state is
  // controlled here; pills are rendered behind a funnel toggle so the header
  // stays compact when nothing's filtered.
  const NO_DEPT = '__no_department__';
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [assigneeSel, setAssigneeSel] = useState<Set<string>>(new Set());
  const [deptSel, setDeptSel] = useState<Set<string>>(new Set());
  const [prioritySel, setPrioritySel] = useState<Set<string>>(new Set());
  const [propSel, setPropSel] = useState<Set<string>>(new Set());
  const [scheduledDateRange, setScheduledDateRange] = useState<{ from: string | null; to: string | null }>(
    { from: null, to: null }
  );
  const clearAllTaskFilters = useCallback(() => {
    setSearch('');
    setStatusSel(new Set());
    setAssigneeSel(new Set());
    setDeptSel(new Set());
    setPrioritySel(new Set());
    setPropSel(new Set());
    setScheduledDateRange({ from: null, to: null });
  }, []);
  const anyTaskFilterActive =
    !!search.trim() ||
    statusSel.size +
      assigneeSel.size +
      deptSel.size +
      prioritySel.size +
      propSel.size >
      0 ||
    !!scheduledDateRange.from ||
    !!scheduledDateRange.to;

  // UI state
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);

  // Draft task state — local-only task not yet persisted
  const [draftTask, setDraftTask] = useState<TaskDraft | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  // Strict single-panel rule (both directions): close our local panel
  // when a context overlay opens; surfaces call closeGlobals() before
  // opening their own panel so it doesn't render behind the overlay.
  // (Original comment retained for context.)
  // Strict single-panel rule: when any global detail panel (reservation
  // overlay or context task overlay) opens, close this surface's local
  // detail panel.
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setExpandedProject(null);
    setDraftTask(null);
  });

  // Column visibility
  const columnVis = useColumnVisibility(selectedBinId, viewMode);

  const allColumnOptions = useMemo(() => {
    if (viewMode === 'property') {
      const names = new Set<string>();
      names.add('No Property');
      tasks.forEach((p) => names.add(p.property_name || 'No Property'));
      allProperties.forEach((p) => { if (p.name) names.add(p.name); });
      const sorted = Array.from(names).sort((a, b) => {
        if (a === 'No Property') return -1;
        if (b === 'No Property') return 1;
        return a.localeCompare(b);
      });
      return sorted.map((name) => ({ id: `prop:${name}`, name }));
    }
    if (viewMode === 'status') {
      return STATUS_ORDER.map((s) => ({ id: `status:${s}`, name: STATUS_LABELS[s] }));
    }
    if (viewMode === 'priority') {
      return PRIORITY_ORDER.map((p) => ({ id: `priority:${p}`, name: PRIORITY_LABELS[p] }));
    }
    if (viewMode === 'department') {
      const names = new Set<string>();
      names.add('No Department');
      tasks.forEach((p) => names.add(p.department_name || 'No Department'));
      departments.forEach((d) => { if (d.name) names.add(d.name); });
      const sorted = Array.from(names).sort((a, b) => {
        if (a === 'No Department') return -1;
        if (b === 'No Department') return 1;
        return a.localeCompare(b);
      });
      return sorted.map((name) => ({ id: `dept:${name}`, name }));
    }
    const names = new Set<string>();
    names.add('Unassigned');
    tasks.forEach((p) => {
      if (p.project_assignments && p.project_assignments.length > 0) {
        p.project_assignments.forEach((a) => names.add(a.user?.name || a.user_id));
      }
    });
    users.forEach((u) => { if (u.name) names.add(u.name); });
    const sorted = Array.from(names).sort((a, b) => {
      if (a === 'Unassigned') return -1;
      if (b === 'Unassigned') return 1;
      return a.localeCompare(b);
    });
    return sorted.map((name) => ({ id: `assignee:${name}`, name }));
  }, [viewMode, tasks, allProperties, departments, users]);

  useEffect(() => {
    if (allColumnOptions.length > 0 && columnVis.initialized) {
      columnVis.initWithDefaults(allColumnOptions.map((c) => c.id));
    }
  }, [allColumnOptions, columnVis.initialized]);

  // ── Filter chip options (derived from the current bin's tasks) ──────────
  const binFilterOptions = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const assigneeMap = new Map<string, { name: string; count: number }>();
    const deptMap = new Map<string, { name: string; count: number }>();
    const propertyMap = new Map<string, number>();
    let noDeptCount = 0;
    tasks.forEach((t) => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      if (t.priority) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
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
      (t.project_assignments || []).forEach((a) => {
        const ex = assigneeMap.get(a.user_id);
        assigneeMap.set(a.user_id, {
          name: a.user?.name || 'Unknown',
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
    const assignees: FilterOption[] = Array.from(assigneeMap.entries())
      .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const departmentsOpt: FilterOption[] = [
      ...Array.from(deptMap.entries())
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: NO_DEPT, label: 'No department', count: noDeptCount },
    ];
    const propertiesOpt: FilterOption[] = Array.from(propertyMap.entries())
      .map(([name, count]) => ({ value: name, label: name, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { statuses, priorities, assignees, departments: departmentsOpt, propertiesOpt };
  }, [tasks]);

  // Apply the filter predicate. The kanban itself receives this filtered
  // list, so column groupings + counts reflect the active filters.
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = scheduledDateRange.from
      ? new Date(scheduledDateRange.from + 'T00:00:00').getTime()
      : null;
    const toMs = scheduledDateRange.to
      ? new Date(scheduledDateRange.to + 'T23:59:59').getTime()
      : null;
    return tasks.filter((t) => {
      if (q) {
        const hay = [
          t.title || '',
          t.template_name || '',
          t.property_name || '',
          t.department_name || '',
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusSel.size > 0 && !statusSel.has(t.status)) return false;
      if (prioritySel.size > 0 && !prioritySel.has(t.priority || '')) return false;
      if (deptSel.size > 0) {
        const key = t.department_id || NO_DEPT;
        if (!deptSel.has(key)) return false;
      }
      if (assigneeSel.size > 0) {
        const has = (t.project_assignments || []).some((a) => assigneeSel.has(a.user_id));
        if (!has) return false;
      }
      if (propSel.size > 0) {
        if (!t.property_name || !propSel.has(t.property_name)) return false;
      }
      if (fromMs !== null || toMs !== null) {
        if (!t.scheduled_date) return false;
        const ts = new Date(t.scheduled_date).getTime();
        if (fromMs !== null && ts < fromMs) return false;
        if (toMs !== null && ts > toMs) return false;
      }
      return true;
    });
  }, [tasks, search, statusSel, assigneeSel, deptSel, prioritySel, propSel, scheduledDateRange]);

  // ============================================================================
  // Bin Navigation
  // ============================================================================
  // Navigation — setting bin state changes the query key, which drives the
  // fetch; a previously-visited bin paints instantly from cache.
  const handleSelectBin = useCallback((binId: string | null) => {
    setSelectedBinId(binId);
    setShowKanban(true);
    setExpandedProject(null);

    if (binId === null) {
      setSelectedBinName('Task Bin');
    } else {
      const bin = binsHook.bins.find(b => b.id === binId);
      setSelectedBinName(bin?.name || 'Sub-Bin');
    }
  }, [binsHook.bins]);

  // Toggle the Task Bin's Global view. The toggle flips apiBinIdFor's output
  // ('__every__' vs null), which flips the query key — the kanban updates
  // without an imperative refetch.
  const handleToggleTaskBinGlobal = useCallback(() => {
    taskBinGlobal.toggle();
  }, [taskBinGlobal]);

  const handleBackToBins = useCallback(() => {
    setShowKanban(false);
    setExpandedProject(null);
    setSelectedBinId(null);
    setSelectedBinName('Task Bin');
    setKanbanSelectionMode(false);
    binsHook.fetchBins();
  }, [binsHook.fetchBins]);

  const handleCreateBin = useCallback(async (name: string, description?: string) => {
    return binsHook.createBin(name, description);
  }, [binsHook.createBin]);

  const handleDeleteBin = useCallback((binId: string) => {
    binsHook.deleteBin(binId);
  }, [binsHook.deleteBin]);

  const handleUpdateBin = useCallback(
    (binId: string, updates: Partial<Pick<ProjectBin, 'name' | 'description' | 'auto_dismiss_enabled' | 'auto_dismiss_days'>>) => {
      return binsHook.updateBin(binId, updates);
    },
    [binsHook.updateBin]
  );

  // ============================================================================
  // Task CRUD via tasks-for-bin APIs
  // ============================================================================
  const handleNewTask = useCallback(() => {
    // In Task Bin view (selectedBinId === null), a new task has no specific
    // sub-bin — it lands in the Task Bin by default. In a sub-bin view we
    // pre-fill bin_id so the new task lands in that sub-bin.
    closeGlobals();
    setExpandedProject(null);
    setDraftTask(emptyDraft({ bin_id: selectedBinId }));
  }, [selectedBinId, closeGlobals]);

  const handleConfirmCreateTask = useCallback(async (payload: TaskCreatePayload) => {
    setCreatingTask(true);
    try {
      const f = payload.fields;
      const body: Record<string, unknown> = {
        title: f.title || 'New Task',
        status: f.status || 'not_started',
        priority: f.priority || 'medium',
        is_binned: true,
        description: f.description || null,
        department_id: f.department_id || null,
        scheduled_date: f.scheduled_date || null,
        scheduled_time: f.scheduled_time || null,
      };
      if (payload.bin_id) body.bin_id = payload.bin_id;
      if (payload.property_name) body.property_name = payload.property_name;
      if (payload.template_id) body.template_id = payload.template_id;
      if (f.assigned_staff?.length) body.assigned_user_ids = f.assigned_staff;

      const res = await fetch('/api/tasks-for-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.data) {
        patchTasks(prev => [...prev, result.data]);
        invalidateAllBinLists();
        setDraftTask(null);
        setExpandedProject(result.data);
      }
    } catch (err) {
      console.error('Error creating task:', err);
      toast.error('Couldn\'t create the task.');
    } finally {
      setCreatingTask(false);
    }
  }, [patchTasks, invalidateAllBinLists]);

  const handleColumnMove = useCallback(async (taskId: string, field: string, value: string) => {
    if (field === 'property_name') {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        const currentProp = task.property_name || '';
        if (currentProp !== value) {
          toast.info('Property can\'t be changed after a task is created.');
          return;
        }
      }
    }
    // Force the kanban to re-sync to server truth so a rejected update
    // doesn't leave the card stranded in the wrong column with a stale
    // status badge until the next interaction. The identity refresh snaps
    // the card back to the cached (pre-drag) truth; the invalidation
    // re-syncs against the server in case the rejection was due to drift.
    const revertKanban = () => {
      patchTasks(prev => [...prev]);
      invalidateAllBinLists();
    };
    try {
      const payload: Record<string, unknown> = {};

      if (field === 'property_name') {
        payload.property_name = value || null;
      } else if (field === 'assigned_user_ids') {
        payload.assigned_user_ids = value ? value.split(',').filter(Boolean) : [];
      } else {
        payload[field] = value || null;
      }

      const res = await apiFetch(`/api/tasks-for-bin/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({} as { error?: string; data?: unknown }));
      if (!res.ok || !result.data) {
        const message = result?.error || `Failed to update task (HTTP ${res.status})`;
        console.error('Error updating task field:', message, result);
        toast.error(message);
        revertKanban();
        return;
      }
      const d = result.data;
      patchTasks(prev => prev.map(t => t.id === taskId ? d : t));
      if (expandedProject?.id === taskId) {
        setExpandedProject(d);
      }
    } catch (err) {
      console.error('Error updating task field:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update task');
      revertKanban();
    }
  }, [expandedProject?.id, tasks, patchTasks, invalidateAllBinLists]);

  // Unread comment count from the task data
  const getUnreadCommentCount = useCallback((project: Project): number => {
    return (project as any).unread_comment_count || 0;
  }, []);

  // Record project view (reuses existing project_views table with task ID)
  const recordView = useCallback(async (taskId: string) => {
    if (!currentUser?.id) return;
    try {
      await fetch('/api/project-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: taskId, user_id: currentUser.id }),
      });
      patchTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, unread_comment_count: 0 } as any : t
      ));
    } catch (err) {
      console.error('Error recording view:', err);
    }
  }, [currentUser?.id, patchTasks]);

  const handleProjectSelect = useCallback((project: Project) => {
    if (expandedProject?.id === project.id) {
      setExpandedProject(null);
    } else {
      closeGlobals();
      setExpandedProject(project);
      recordView(project.id);
    }
  }, [expandedProject?.id, recordView, closeGlobals]);

  // ============================================================================
  // RENDER
  // ============================================================================
  if (!showKanban) {
    return (
      <BinPicker
        bins={binsHook.bins}
        loadingBins={binsHook.loadingBins}
        totalProjects={binsHook.totalProjects}
        onSelectBin={handleSelectBin}
        onCreateBin={handleCreateBin}
        onDeleteBin={handleDeleteBin}
        onUpdateBin={handleUpdateBin}
      />
    );
  }

  return (
    // `relative` so the detail overlay below anchors here. List always
    // takes full width — when a project is expanded the panel hovers
    // over the right 1/3 (matches Tasks / Properties / Timeline).
    <div className="relative h-full overflow-hidden bg-white dark:bg-card">
      {/* Left Panel - Kanban Board */}
      <div className="w-full h-full flex flex-col">
        <div className="flex-shrink-0 relative z-20 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
          {/* Title block — back-to-bins breadcrumb + bin name as the page
              title, Global scope toggle, and a fine-print line (task count +
              current board orientation). */}
          <div className="px-8 pt-6 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={handleBackToBins}
                className="flex-shrink-0 flex items-center gap-1 text-[12px] font-medium text-neutral-500 dark:text-[#a09e9a] hover:text-neutral-900 dark:hover:text-white transition-colors uppercase tracking-[0.04em]"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Bins
              </button>
              <span className="flex-shrink-0 text-neutral-400/50 dark:text-white/20">/</span>
              <h1 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed] truncate">
                {selectedBinName}
              </h1>
              {/* Global toggle — only inside the Task Bin (selectedBinId === null).
                  When ON, widens the Task Bin to every binned task across the
                  Task Bin and every sub-bin. Persists across sessions. */}
              {selectedBinId === null && (
                <button
                  onClick={handleToggleTaskBinGlobal}
                  title={taskBinGlobal.enabled
                    ? 'Global view ON — showing every binned task. Click to scope back to the Task Bin only.'
                    : 'Global view OFF — showing only the Task Bin. Click to widen to every binned task.'}
                  aria-pressed={taskBinGlobal.enabled}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                    taskBinGlobal.enabled
                      ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
                      : 'bg-transparent text-neutral-500 dark:text-[#a09e9a] border-neutral-200 dark:border-white/10 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-white/[0.04] hover:text-neutral-800 dark:hover:text-white'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18" />
                  </svg>
                  Global
                </button>
              )}
            </div>
            {/* Fine print — task count + current board orientation. */}
            <div className="flex items-center gap-3 mt-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
              <span>
                {anyTaskFilterActive
                  ? `${filteredTasks.length} of ${tasks.length} tasks`
                  : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
              <span>By {VIEW_MODE_LABELS[viewMode]}</span>
            </div>
          </div>

          {/* Controls row */}
          <div className="px-8 pb-4">
          <div className="flex items-center gap-3 min-w-0 flex-nowrap">
            {/* Task search + filter pills (matches the Schedule page UX) */}
            <CompactSearch value={search} onChange={setSearch} placeholder="Search tasks…" />

            <button
              type="button"
              onClick={() => setFiltersExpanded((v) => !v)}
              title={filtersExpanded ? 'Hide filters' : 'Show filters'}
              aria-pressed={filtersExpanded}
              className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                filtersExpanded || anyTaskFilterActive
                  ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                  : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]'
              }`}
            >
              <FilterIcon className="w-4 h-4" />
            </button>

            {filtersExpanded && (
              <TaskFilterBar
                inline
                statusOptions={binFilterOptions.statuses}
                statusSelected={statusSel}
                onStatusChange={setStatusSel}
                assigneeOptions={binFilterOptions.assignees}
                assigneeSelected={assigneeSel}
                onAssigneeChange={setAssigneeSel}
                departmentOptions={binFilterOptions.departments}
                departmentSelected={deptSel}
                onDepartmentChange={setDeptSel}
                priorityOptions={binFilterOptions.priorities}
                prioritySelected={prioritySel}
                onPriorityChange={setPrioritySel}
                propertyOptions={binFilterOptions.propertiesOpt}
                propertySelected={propSel}
                onPropertyChange={setPropSel}
                scheduledDateRange={scheduledDateRange}
                onScheduledDateRangeChange={setScheduledDateRange}
                onClearAll={clearAllTaskFilters}
                anyFilterActive={anyTaskFilterActive}
                totalCount={tasks.length}
                filteredCount={filteredTasks.length}
              />
            )}

            {/* Right group: board orientation + column visibility + new task +
                select. `ml-auto` pins them to the right of the controls row;
                `flex-shrink-0` guards against the chip lane crushing them. */}
            <div className="ml-auto flex items-center gap-3 flex-shrink-0">
            <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
            <ColumnPicker
              columns={allColumnOptions}
              visibleColumnIds={columnVis.visibleIds}
              onToggle={columnVis.toggle}
              onSelectAll={() => columnVis.selectAll(allColumnOptions.map((c) => c.id))}
              onClearAll={columnVis.clearAll}
            />
            <Button size="sm" onClick={handleNewTask}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New Task
            </Button>
            {tasks.length > 0 && !kanbanSelectionMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setKanbanSelectionMode(true)}
                title="Select tasks to dismiss in bulk"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l-3 3-1.5-1.5" />
                </svg>
                Select
              </Button>
            )}
            </div>
          </div>
          </div>
        </div>

        {loadingTasks ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-neutral-500">Loading tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                No tasks in this bin yet.
              </p>
              <Button onClick={handleNewTask}>
                Create First Task
              </Button>
            </div>
          </div>
        ) : (
          <ProjectsKanban
            projects={filteredTasks}
            viewMode={viewMode}
            allProperties={allProperties}
            users={users}
            departments={departments}
            onProjectClick={handleProjectSelect}
            expandedProjectId={expandedProject?.id || null}
            getUnreadCommentCount={getUnreadCommentCount}
            onColumnMove={handleColumnMove}
            visibleColumnIds={columnVis.visibleIds}
            bins={binsHook.bins}
            selectionMode={kanbanSelectionMode}
            onSelectionModeChange={setKanbanSelectionMode}
            onBulkDismiss={async (taskIds) => {
              if (taskIds.length === 0) return;
              try {
                const res = await fetch('/api/tasks-bulk-dismiss', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskIds }),
                });
                const result = await res.json();
                if (res.ok) {
                  const dismissed: string[] = result?.dismissed_ids || taskIds;
                  const dismissedSet = new Set(dismissed);
                  patchTasks(prev => prev.filter(t => !dismissedSet.has(t.id)));
                  invalidateAllBinLists();
                  if (expandedProject && dismissedSet.has(expandedProject.id)) {
                    setExpandedProject(null);
                  }
                  binsHook.fetchBins();
                } else {
                  console.error('Bulk dismiss failed:', result?.error);
                  toast.error(result?.error || 'Couldn\'t dismiss the selected tasks.');
                }
              } catch (err) {
                console.error('Error bulk dismissing tasks:', err);
                toast.error('Couldn\'t dismiss the selected tasks.');
              }
            }}
          />
        )}
      </div>

      {/* Right Panel - Task Detail */}
      {(expandedProject || draftTask) && (
        <div className={DESKTOP_DETAIL_PANEL_FLEX}>
          <TaskDetailPanel
            task={expandedProject ? projectToTaskInput(expandedProject, users) : null}
            onClose={() => { setExpandedProject(null); setDraftTask(null); }}
            onSaved={(row) => {
              patchTasks(prev => prev.map(t => t.id === row.task_id ? mergeRowIntoProject(t, row) : t));
              setExpandedProject(prev => (prev && prev.id === row.task_id ? mergeRowIntoProject(prev, row) : prev));
            }}
            onDeleted={(taskId) => {
              patchTasks(prev => prev.filter(t => t.id !== taskId));
              setExpandedProject(null);
            }}
            onOpenInPage={
              expandedProject
                ? () => {
                    const id = expandedProject.id;
                    setExpandedProject(null);
                    setDraftTask(null);
                    router.push(taskPath(id));
                  }
                : undefined
            }
            draft={draftTask}
            onDraftChange={setDraftTask}
            onConfirmCreate={handleConfirmCreateTask}
            creating={creatingTask}
          />
        </div>
      )}
    </div>
  );
}

const ProjectsWindow = memo(ProjectsWindowContent);
export default ProjectsWindow;
