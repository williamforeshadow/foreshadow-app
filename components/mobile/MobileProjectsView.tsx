'use client';

import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import MobileBinPicker from '@/components/mobile/MobileBinPicker';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput, type TaskDetailInput } from '@/components/tasks/detail/taskInput';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';
import { ProjectsKanban } from '@/components/windows/projects/ProjectsKanban';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { useTaskBinGlobalView } from '@/lib/hooks/useTaskBinGlobalView';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { useProperties, fetchJson, qk } from '@/lib/queries';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STATUS_ORDER, STATUS_LABELS, PRIORITY_ORDER, PRIORITY_LABELS } from '@/lib/types';
import type { ProjectViewMode } from '@/lib/types';
import { ColumnPicker } from '@/components/windows/projects/ColumnPicker';
import type { Project, User } from '@/lib/types';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { MobileTaskFilterBar } from '@/components/mobile/MobileTaskFilterBar';
import type { FilterOption } from '@/components/tasks/TaskFilterBar';

// ============================================================================
// Types
// ============================================================================

type Screen =
  | { type: 'bins' }
  | { type: 'kanban'; binId: string | null; binName: string }
  | { type: 'detail'; project: Project; binId: string | null; binName: string };

const EMPTY_PROJECTS: Project[] = [];

// ============================================================================
// TaskDetailPanel adapter — the panel speaks TaskDetailInput; this view's
// screen/kanban state speaks Project.
// ============================================================================

// Fold a saved TaskDetailInput row back into the Project shape the kanban
// cache + screen state use. `prev` supplies fields the panel doesn't surface
// (e.g. anything only ever set by the list fetch).
function taskInputToProject(row: TaskDetailInput, prev: Project): Project {
  const next: Project = {
    ...prev,
    id: row.task_id,
    property_id: row.property_id,
    property_name: row.property_name,
    bin_id: row.bin_id,
    is_binned: row.is_binned,
    template_id: row.template_id,
    template_name: row.template_name,
    title: row.title || row.template_name || 'Task',
    description: (row.description as Project['description']) ?? null,
    status: row.status as Project['status'],
    priority: row.priority as Project['priority'],
    department_id: row.department_id,
    department_name: row.department_name,
    scheduled_date: row.scheduled_date,
    scheduled_time: row.scheduled_time,
    reservation_id: row.reservation_id,
    form_metadata: (row.form_metadata as Record<string, unknown>) ?? undefined,
    project_assignments: row.assigned_users.map((u) => ({
      user_id: u.user_id,
      user: { id: u.user_id, name: u.name, avatar: u.avatar ?? undefined, role: u.role },
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return {
    ...next,
    bin_name: row.bin_name,
    unread_comment_count: row.unread_comment_count,
  } as Project;
}

interface MobileProjectsViewProps {
  users: User[];
  onMenuTap?: () => void;
  /** False while the view is kept mounted but hidden behind another tab. */
  isActive?: boolean;
}

// ============================================================================
// View Mode Toggle (compact mobile version)
// ============================================================================

const VIEW_MODE_LABELS: Record<ProjectViewMode, string> = {
  property: 'Property',
  status: 'Status',
  priority: 'Priority',
  department: 'Dept',
  assignee: 'Assignee',
};

const ALL_VIEW_MODES: ProjectViewMode[] = ['property', 'status', 'priority', 'department', 'assignee'];

function MobileViewModeToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: ProjectViewMode;
  setViewMode: (m: ProjectViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Portal the dropdown to <body> so it escapes the filter lane's
  // `overflow-x-auto` clip (the lane is what makes the pills swipeable).
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gutter = 8;
      const w = popRef.current?.offsetWidth ?? 140;
      const left = Math.min(r.left, Math.max(gutter, window.innerWidth - w - gutter));
      setPos({ left, top: r.bottom + 6 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onTap = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onTap);
    document.addEventListener('touchstart', onTap);
    return () => {
      document.removeEventListener('mousedown', onTap);
      document.removeEventListener('touchstart', onTap);
    };
  }, [open]);

  return (
    <>
      {/* Standard pill — single-select board orientation. The chosen mode is
          surfaced in the header fine print ("By Status"), not inside the
          pill, so the label stays a clean "Boards". */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] active:opacity-70 transition-opacity"
      >
        Boards
        <svg className={`w-3 h-3 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && mounted && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
          className="rounded-xl bg-white dark:bg-[#1a1a1d] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl min-w-[140px]"
        >
          <div className="flex flex-col gap-0.5 p-1.5">
            {ALL_VIEW_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setViewMode(mode);
                  setOpen(false);
                }}
                className={`px-3.5 py-2 text-[12px] font-medium rounded-lg text-left transition-all ${
                  viewMode === mode
                    ? 'bg-neutral-100 dark:bg-[rgba(255,255,255,0.06)] text-neutral-900 dark:text-[#f0efed]'
                    : 'text-neutral-500 dark:text-[#66645f] active:bg-neutral-50 dark:active:bg-[rgba(255,255,255,0.03)]'
                }`}
              >
                {VIEW_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ============================================================================
// Component
// ============================================================================

export default function MobileProjectsView({ users, onMenuTap, isActive = true }: MobileProjectsViewProps) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { departments } = useDepartments();
  const binsHook = useProjectBins({ currentUser: currentUser as User | null });

  const [screen, setScreen] = useState<Screen>({ type: 'bins' });
  const [kanbanDragging, setKanbanDragging] = useState(false);

  // Strict single-panel rule: when any global detail panel (reservation
  // overlay or context task overlay) opens, drop the local detail screen.
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setScreen((prev) => (prev.type === 'detail' ? { type: 'bins' } : prev));
  });

  const { properties: allProperties } = useProperties();
  const [viewMode, setViewMode] = useState<ProjectViewMode>('status');
  const [kanbanSelectionMode, setKanbanSelectionMode] = useState(false);

  // Draft (new-task) creation is in-flight while the panel's Create action
  // awaits the POST. TaskDetailPanel owns everything else about the draft —
  // it lives entirely in screen.project until confirmed.
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [createSeedBinId, setCreateSeedBinId] = useState<string | null>(null);

  // Task Bin "Global" toggle. Mirrors ProjectsWindow desktop: when ON inside
  // the Task Bin (activeBinId === null), widens the kanban to every binned
  // task across the Task Bin and every sub-bin via the '__every__' API
  // sentinel. Persisted in localStorage so the preference survives reloads.
  const taskBinGlobal = useTaskBinGlobalView();
  const apiBinIdFor = useCallback(
    (binId: string | null) =>
      binId === null && taskBinGlobal.enabled ? '__every__' : binId,
    [taskBinGlobal.enabled],
  );

  // The bin task list lives in the shared query cache, keyed by the bin the
  // user is looking at (derived from screen state — navigation just sets the
  // screen and the key change drives fetching). Previously-visited bins paint
  // instantly from cache; the spinner shows only on a bin's first-ever visit.
  const viewerId = currentUser?.id ?? null;
  const activeApiBinId = screen.type === 'bins' ? null : apiBinIdFor(screen.binId);
  const tasksQuery = useQuery({
    queryKey: qk.tasksForBin(activeApiBinId, viewerId),
    enabled: screen.type !== 'bins',
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
      console.error('Error fetching tasks:', tasksQuery.error);
      toast.error('Failed to load tasks');
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

  // Quiet refresh when the tab is re-shown after being hidden (keep-mounted
  // tabs no longer remount). Data stays painted; invalidation refreshes it
  // in the background.
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (isActive && !wasActive.current) {
      queryClient.invalidateQueries({ queryKey: qk.projectBins });
      queryClient.invalidateQueries({ queryKey: ['tasks-for-bin'] });
    }
    wasActive.current = isActive;
  }, [isActive, queryClient]);

  // ---- Task filter / search state (mirrors desktop Bins) ---------------
  const NO_DEPT = '__no_department__';
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

  // Column visibility for the kanban
  const activeBinId = screen.type !== 'bins' ? (screen as any).binId : null;
  const columnVis = useColumnVisibility(activeBinId, viewMode);


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

  // ---- Filter chip options derived from the current bin's tasks --------
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

  // Navigation — setting the screen changes the query key, which drives the
  // fetch; a previously-visited bin paints instantly from cache.
  const navigateToBin = useCallback((binId: string | null, binName: string) => {
    setScreen({ type: 'kanban', binId, binName });
  }, []);

  // Toggle the Task Bin's Global view. The toggle flips apiBinIdFor's output
  // ('__every__' vs null), which flips the query key — the kanban updates
  // without an imperative refetch.
  const handleToggleTaskBinGlobal = useCallback(() => {
    taskBinGlobal.toggle();
  }, [taskBinGlobal]);

  const navigateToProject = useCallback((project: Project, binId: string | null, binName: string) => {
    if (currentUser?.id) {
      fetch('/api/project-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, user_id: currentUser.id }),
      }).catch(() => {});
    }
    closeGlobals();
    setScreen({ type: 'detail', project, binId, binName });
  }, [currentUser?.id, closeGlobals]);

  const goBack = useCallback(() => {
    if (screen.type === 'detail') {
      // Detail edits already patched the bin's live cache — no refetch needed.
      setScreen({ type: 'kanban', binId: screen.binId, binName: screen.binName });
    } else if (screen.type === 'kanban') {
      setKanbanSelectionMode(false);
      setScreen({ type: 'bins' });
      binsHook.fetchBins();
    }
  }, [screen, binsHook]);

  const handleColumnMove = useCallback(async (taskId: string, field: string, value: string) => {
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
      patchTasks(prev => prev.map(t => t.id === taskId ? result.data : t));
    } catch (err) {
      console.error('Error updating task field:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update task');
      revertKanban();
    }
  }, [patchTasks, invalidateAllBinLists]);

  const handleNewTask = useCallback(() => {
    if (screen.type !== 'kanban') return;
    // Task Bin view (screen.binId === null) lands the task in the Task Bin;
    // a sub-bin view pre-fills that sub-bin.
    closeGlobals();
    setCreateSeedBinId(screen.binId);
    setCreatingOpen(true);
  }, [screen, closeGlobals]);

  // Creation is owned by useTaskCreate (CreateTaskPanel).

  const getUnreadCommentCount = useCallback((project: Project): number => {
    return (project as any).unread_comment_count || 0;
  }, []);

  return (
    <div className="h-full">
      {/* Bins screen */}
      {screen.type === 'bins' && (
        <MobileBinPicker
          bins={binsHook.bins}
          totalProjects={binsHook.totalProjects}
          loadingBins={binsHook.loadingBins}
          onSelectBin={(binId) => {
            const bin = binsHook.bins.find(b => b.id === binId);
            navigateToBin(binId, bin?.name || 'Sub-Bin');
          }}
          onSelectTaskBin={() => navigateToBin(null, 'Task Bin')}
          onCreateBin={binsHook.createBin}
          onUpdateBin={binsHook.updateBin}
          onDeleteBin={binsHook.deleteBin}
          onMenuTap={onMenuTap}
        />
      )}

      {/* Kanban screen */}
      {screen.type === 'kanban' && (
        <div className="flex flex-col h-full relative">
          {/* Header region — one continuous neutral gradient behind the title
              + fine print + toolbar, capped with a hairline where it meets
              the flat kanban below. */}
          <div className="shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
          {/* Title row — back button + bin name (Global scope toggle inline
              on the right, Task Bin only). Mirrors the Tasks / Assignments /
              Schedule mobile header pattern. */}
          <div
            className="px-[22px] pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={goBack}
                className="-ml-2 w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors shrink-0"
                aria-label="Back to bins"
              >
                <svg className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-[20px] font-semibold tracking-tight leading-none text-neutral-900 dark:text-[#f0efed] truncate">
                {screen.binName}
              </h1>
              {/* Global toggle — only inside the Task Bin (binId === null).
                  Widens the Task Bin to every binned task across the Task Bin
                  and every sub-bin. Persists in localStorage. */}
              {screen.binId === null && (
                <button
                  onClick={handleToggleTaskBinGlobal}
                  aria-pressed={taskBinGlobal.enabled}
                  className={`ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                    taskBinGlobal.enabled
                      ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
                      : 'bg-transparent border-neutral-200 dark:border-[rgba(255,255,255,0.08)] text-neutral-500 dark:text-[#a09e9a] active:opacity-70'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18" />
                  </svg>
                  Global
                </button>
              )}
            </div>

            {/* Fine print — task count + current board orientation
                ("43 tasks · By Status"). */}
            <div className="flex items-center gap-2 mt-1 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
              <span>
                {anyTaskFilterActive
                  ? `${filteredTasks.length} of ${tasks.length} tasks`
                  : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
              <span>By {VIEW_MODE_LABELS[viewMode]}</span>
            </div>
          </div>

          {/* Single controls row: search/filter (swipeable lane) →
              Boards + Columns (in-lane, via laneControls) → Select + task
              (pinned right, via trailingControls + onNewTask). Background
              comes from the header-gradient wrapper. */}
          <div className="shrink-0">
            <MobileTaskFilterBar
              search={search}
              onSearchChange={setSearch}
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
              onNewTask={handleNewTask}
              totalCount={tasks.length}
              filteredCount={filteredTasks.length}
              laneControls={
                <div className="flex items-center gap-2 flex-shrink-0">
                  <MobileViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
                  <ColumnPicker
                    columns={allColumnOptions}
                    visibleColumnIds={columnVis.visibleIds}
                    onToggle={columnVis.toggle}
                    onSelectAll={() => columnVis.selectAll(allColumnOptions.map((c) => c.id))}
                    onClearAll={columnVis.clearAll}
                    showCount={false}
                  />
                </div>
              }
              trailingControls={
                tasks.length > 0 && !kanbanSelectionMode ? (
                  <button
                    onClick={() => setKanbanSelectionMode(true)}
                    className="flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] active:opacity-70 transition-opacity"
                  >
                    Select
                  </button>
                ) : undefined
              }
            />
          </div>
          </div>

          <div className={`flex-1 min-h-0 flex flex-col mobile-kanban-wrapper${kanbanDragging ? ' is-dragging' : ''}`}>
            {loadingTasks ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-sm font-medium text-neutral-400 dark:text-[#66645f]">No tasks yet</p>
                <button
                  onClick={handleNewTask}
                  className="mt-3 text-xs font-medium text-neutral-600 dark:text-[#a09e9a] active:opacity-70"
                >
                  + Create one
                </button>
              </div>
            ) : (
              <ProjectsKanban
                projects={filteredTasks}
                viewMode={viewMode}
                allProperties={allProperties}
                users={users}
                departments={departments}
                onProjectClick={(project) => navigateToProject(project, screen.binId, screen.binName)}
                expandedProjectId={null}
                getUnreadCommentCount={getUnreadCommentCount}
                onColumnMove={handleColumnMove}
                visibleColumnIds={columnVis.visibleIds}
                onDraggingChange={setKanbanDragging}
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
                      binsHook.fetchBins();
                    } else {
                      console.error('Bulk dismiss failed:', result?.error);
                      toast.error(result?.error || 'Failed to dismiss tasks');
                    }
                  } catch (err) {
                    console.error('Error bulk dismissing tasks:', err);
                    toast.error('Failed to dismiss tasks');
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Task detail screen */}
      {screen.type === 'detail' && (() => {
        return (
          <TaskDetailPanel
            task={projectToTaskInput(screen.project, users)}
            onClose={goBack}
            onSaved={(row) => {
              patchTasks(prev => prev.map(t => t.id === row.task_id ? taskInputToProject(row, t) : t));
              setScreen(prev => prev.type === 'detail' ? { ...prev, project: taskInputToProject(row, prev.project) } : prev);
            }}
            onDeleted={(taskId) => {
              patchTasks(prev => prev.filter(t => t.id !== taskId));
              invalidateAllBinLists();
              goBack();
            }}
          />
        );
      })()}

      {creatingOpen && (
        <CreateTaskPanel
          seed={{ bin_id: createSeedBinId, is_binned: true }}
          onClose={() => setCreatingOpen(false)}
          onCreated={(row) => {
            setCreatingOpen(false);
            patchTasks((prev) => [...prev, row as unknown as Project]);
            invalidateAllBinLists();
          }}
        />
      )}
    </div>
  );
}
