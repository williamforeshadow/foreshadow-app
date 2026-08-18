'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMyAssignments } from '@/lib/queries';
import { useAuth } from '@/lib/authContext';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import type { Project, Task, PropertyOccupancy } from '@/lib/types';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import {
  groupTasksByDate,
  todayISO,
  TaskSectionHeader,
  useCollapsedSections,
} from '@/components/tasks/taskDateSections';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';
import { MobileTaskFilterBar } from '@/components/mobile/MobileTaskFilterBar';
import { LoadingState } from '@/components/ui/loading-state';
import type {
  FilterOption,
  SortKey,
  SortDir,
} from '@/components/tasks/TaskFilterBar';

interface Assignee {
  user_id: string;
  name: string;
  avatar: string | null;
}

interface RawAssignedUser {
  user_id: string;
  name?: string | null;
  avatar?: string | null;
}

interface RawProjectAssignment {
  user_id: string;
  user?: {
    name?: string | null;
    avatar?: string | null;
  } | null;
}

interface RawTask {
  [key: string]: unknown;
  id?: string;
  task_id?: string;
  title?: string | null;
  template_name?: string | null;
  property_name?: string | null;
  status?: string | null;
  priority?: string | null;
  department_id?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  assigned_users?: RawAssignedUser[];
  reservation_id?: string | null;
  occupancy?: PropertyOccupancy | null;
}

interface RawProject {
  [key: string]: unknown;
  id?: string;
  task_id?: string;
  title?: string | null;
  property_name?: string | null;
  status?: string | null;
  priority?: string | null;
  department_id?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  project_assignments?: RawProjectAssignment[];
  reservation_id?: string | null;
}

type AssignmentRaw = RawTask | RawProject;
type BivariantCallback<T> = { bivarianceHack(value: T): void }['bivarianceHack'];

interface UnifiedItem {
  key: string;
  source: 'task' | 'project';
  title: string;
  property_name: string;
  status: string;
  priority: string;
  department_id: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  assignees: Assignee[];
  // Reservation FK on tasks. Drives the small "key" badge after the title.
  // Always null for projects (they live in tasks-for-bin land which filters
  // out reservation-bound rows).
  reservation_id?: string | null;
  // Live occupancy of the row's property, from the same payload as every other
  // field. Null for property-less rows and for projects (which carry no
  // property_id for the server to resolve).
  occupancy?: PropertyOccupancy | null;
  raw: AssignmentRaw;
}

interface MobileMyAssignmentsViewProps {
  onTaskClick?: BivariantCallback<Task & { id?: string }>;
  onProjectClick?: BivariantCallback<Project & { task_id?: string }>;
  refreshTrigger?: number;
  onMenuTap?: () => void;
  /** False while the view is kept mounted but hidden behind another tab. */
  isActive?: boolean;
}

export default function MobileMyAssignmentsView({
  onTaskClick,
  onProjectClick,
  refreshTrigger,
  onMenuTap,
  isActive = true,
}: MobileMyAssignmentsViewProps) {
  const { user, loading: authLoading } = useAuth();
  const { departments: allDepts } = useDepartments();
  const router = useRouter();

  // ---- Filter / search / sort state (mirrors desktop My Assignments) ----
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
  const [sortKey, setSortKey] = useState<SortKey>('scheduled');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSortChange = useCallback((k: SortKey, d: SortDir) => {
    setSortKey(k);
    setSortDir(d);
  }, []);
  const clearAllAssignmentFilters = useCallback(() => {
    setSearch('');
    setStatusSel(new Set());
    setAssigneeSel(new Set());
    setDeptSel(new Set());
    setPrioritySel(new Set());
    setPropSel(new Set());
    setScheduledDateRange({ from: null, to: null });
  }, []);
  const anyAssignmentFilterActive =
    !!search.trim() ||
    statusSel.size +
      assigneeSel.size +
      deptSel.size +
      prioritySel.size +
      propSel.size >
      0 ||
    !!scheduledDateRange.from ||
    !!scheduledDateRange.to;
  // "+ New task" opens the create panel right here — routing through the
  // Tasks page flashed that whole tab before the panel appeared.
  const [creatingOpen, setCreatingOpen] = useState(false);
  const handleNewTask = useCallback(() => {
    setCreatingOpen(true);
  }, []);
  const { collapsed: collapsedSections, toggle: toggleSection } =
    useCollapsedSections();

  // Cached, shared query — remounts (e.g. returning from /messages) paint
  // instantly from cache and refresh in the background. Refetches are
  // naturally silent: existing data stays visible while fresh data loads.
  const {
    rawData,
    loading,
    error: queryError,
    refetch: fetchAssignments,
  } = useMyAssignments<RawTask, RawProject>(user?.id);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to fetch assignments'
    : null;

  // Bumped by the parent when a detail overlay closes (mount fetch is owned
  // by the query itself).
  useEffect(() => {
    if (refreshTrigger) fetchAssignments();
  }, [refreshTrigger, fetchAssignments]);

  // Quiet refresh when the tab is re-shown after being hidden.
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (isActive && !wasActive.current) fetchAssignments();
    wasActive.current = isActive;
  }, [isActive, fetchAssignments]);

  const items = useMemo((): UnifiedItem[] => {
    if (!rawData) return [];
    const result: UnifiedItem[] = [];

    for (const task of rawData.tasks) {
      result.push({
        key: `task-${task.task_id ?? task.title ?? result.length}`,
        source: 'task',
        title: task.title || task.template_name || 'Unnamed Task',
        property_name: task.property_name || '',
        status: task.status || 'not_started',
        priority: task.priority || 'medium',
        department_id: task.department_id || null,
        scheduled_date: task.scheduled_date,
        scheduled_time: task.scheduled_time,
        assignees: (task.assigned_users || []).map((u) => ({
          user_id: u.user_id,
          name: u.name || 'Unknown',
          avatar: u.avatar || null,
        })),
        reservation_id: task.reservation_id || null,
        occupancy: task.occupancy || null,
        raw: task,
      });
    }

    for (const project of rawData.projects) {
      result.push({
        key: `proj-${project.id ?? project.title ?? result.length}`,
        source: 'project',
        title: project.title || 'Untitled Task',
        property_name: project.property_name || '',
        status: project.status || 'not_started',
        priority: project.priority || 'medium',
        department_id: project.department_id || null,
        scheduled_date: project.scheduled_date,
        scheduled_time: project.scheduled_time,
        assignees: (project.project_assignments || []).map((a) => ({
          user_id: a.user_id,
          name: a.user?.name || 'Unknown',
          avatar: a.user?.avatar || null,
        })),
        raw: project,
      });
    }

    return result;
  }, [rawData]);

  // ---- Filter options (derived from items) ------------------------------
  const assignmentFilterOptions = useMemo(() => {
    const deptIdToName = new Map<string, string>();
    for (const d of allDepts) {
      if (d.id) deptIdToName.set(d.id, d.name || 'Department');
    }
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const assigneeMap = new Map<string, { name: string; count: number }>();
    const deptMap = new Map<string, { name: string; count: number }>();
    const propertyMap = new Map<string, number>();
    let noDeptCount = 0;
    items.forEach((t) => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
      if (t.department_id) {
        const ex = deptMap.get(t.department_id);
        deptMap.set(t.department_id, {
          name: deptIdToName.get(t.department_id) || 'Department',
          count: (ex?.count || 0) + 1,
        });
      } else {
        noDeptCount++;
      }
      if (t.property_name) {
        propertyMap.set(t.property_name, (propertyMap.get(t.property_name) || 0) + 1);
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
  }, [items, allDepts]);

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
        const hay = [t.title, t.property_name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusSel.size > 0 && !statusSel.has(t.status)) return false;
      if (prioritySel.size > 0 && !prioritySel.has(t.priority || '')) return false;
      if (deptSel.size > 0) {
        const key = t.department_id || NO_DEPT;
        if (!deptSel.has(key)) return false;
      }
      if (assigneeSel.size > 0) {
        const has = (t.assignees || []).some((a) => assigneeSel.has(a.user_id));
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
  }, [items, search, statusSel, assigneeSel, deptSel, prioritySel, propSel, scheduledDateRange]);

  const { groups, todayTurnoverCount } = useMemo(() => {
    const todayStr = todayISO();

    // Sort the whole list first — grouping preserves order, so this becomes
    // the within-section order. The user's SortKey / SortDir come from the
    // filter bar; the outer date sections are structural.
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
          cmp = String((a.raw as any).created_at || '').localeCompare(
            String((b.raw as any).created_at || '')
          );
          break;
        case 'updated':
        case 'completed':
          cmp = String((a.raw as any).updated_at || '').localeCompare(
            String((b.raw as any).updated_at || '')
          );
          break;
        case 'priority':
          cmp = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    };
    const sorted = [...filteredItems].sort(compareItems);

    const result = groupTasksByDate(sorted, {
      includeCompletedSection: false,
      dayOrder: sortKey === 'scheduled' ? sortDir : 'asc',
    });

    // Unscheduled rows can't be ordered by scheduled date — fall back to
    // status when that's the chosen axis.
    if (sortKey === 'scheduled') {
      const noDate = result.find((g) => g.kind === 'noDate');
      noDate?.items.sort(
        (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3)
      );
    }

    let turnoverCount = 0;
    for (const item of filteredItems) {
      if (item.status === 'complete') continue;
      // "Turnover" badge counts reservation-bound tasks scheduled today —
      // turnovers are the only path that produces reservation_id-linked
      // tasks, regardless of which template/department spawned them.
      if (item.scheduled_date === todayStr && item.raw?.reservation_id) turnoverCount++;
    }

    return { groups: result, todayTurnoverCount: turnoverCount };
  }, [filteredItems, sortKey, sortDir]);

  const todayFormatted = useMemo(() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'short' });
    const day = now.getDate();
    return `${weekday} · ${month} ${day}`;
  }, []);

  // Loading / error / auth states
  if (authLoading) {
    return (
      <div className="flex flex-1 min-h-[60vh] flex-col items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-6">
        <p className="text-neutral-600 dark:text-[#a09e9a] font-medium mb-3">Sign in to see your assignments</p>
        <Button onClick={() => router.push('/login')}>Sign In</Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 min-h-[60vh] flex-col items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-6">
        <p className="text-neutral-600 dark:text-[#a09e9a] text-center text-sm mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchAssignments()}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header region — one continuous neutral gradient behind the title,
          fine print + toolbar, capped with a hairline where it meets the
          content below. */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,var(--header-scrim),transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
      {/* Header */}
      <div
        className="px-[22px] pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {onMenuTap && (
            <button
              onClick={onMenuTap}
              className="-ml-2 w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
              aria-label="Open menu"
            >
              <svg className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <h1 className="text-[20px] font-semibold tracking-tight leading-tight text-neutral-900 dark:text-[#f0efed] truncate">
            My Assignments
          </h1>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
          <span>{todayFormatted}</span>
        </div>
      </div>

      {/* Filter / search / sort bar — same axes as desktop My Assignments.
          Background comes from the header-gradient wrapper. */}
      <div className="shrink-0">
        <MobileTaskFilterBar
          search={search}
          onSearchChange={setSearch}
          statusOptions={assignmentFilterOptions.statuses}
          statusSelected={statusSel}
          onStatusChange={setStatusSel}
          assigneeOptions={assignmentFilterOptions.assignees}
          assigneeSelected={assigneeSel}
          onAssigneeChange={setAssigneeSel}
          departmentOptions={assignmentFilterOptions.departments}
          departmentSelected={deptSel}
          onDepartmentChange={setDeptSel}
          priorityOptions={assignmentFilterOptions.priorities}
          prioritySelected={prioritySel}
          onPriorityChange={setPrioritySel}
          propertyOptions={assignmentFilterOptions.propertiesOpt}
          propertySelected={propSel}
          onPropertyChange={setPropSel}
          scheduledDateRange={scheduledDateRange}
          onScheduledDateRangeChange={setScheduledDateRange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onClearAll={clearAllAssignmentFilters}
          anyFilterActive={anyAssignmentFilterActive}
          onNewTask={handleNewTask}
          totalCount={items.length}
          filteredCount={filteredItems.length}
        />
      </div>
      </div>

      {/* Turnover banner */}
      {todayTurnoverCount > 0 && (
        <div className="mx-[22px] mb-4 px-[18px] py-4 bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] rounded-xl flex items-center justify-between relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-neutral-800 dark:bg-[#f0efed]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.1em] font-semibold">Due today</span>
            <span className="text-[15px] font-medium text-neutral-800 dark:text-[#f0efed] tracking-tight">
              {todayTurnoverCount === 1 ? 'One turnover' : todayTurnoverCount === 2 ? 'Two turnovers' : todayTurnoverCount === 3 ? 'Three turnovers' : `${todayTurnoverCount} turnovers`}
            </span>
          </div>
          <span className="font-mono text-[32px] font-normal text-neutral-800 dark:text-[#f0efed] leading-none tracking-tight tabular-nums">
            {todayTurnoverCount}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto hide-scrollbar pb-mobile-nav">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-6">
            <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No tasks assigned</p>
            <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">You are all caught up</p>
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsedSections.has(group.id);
            return (
              <div key={group.id} className="px-[22px] pt-5">
                <TaskSectionHeader
                  label={group.label}
                  collapsed={isCollapsed}
                  onToggle={() => toggleSection(group.id)}
                />

                {/* Assignment cards */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-2.5">
                    {group.items.map((item) => {
                      const dept = allDepts.find((d) => d.id === item.department_id);
                      const DeptIcon = getDepartmentIcon(dept?.icon);
                      const handleRowClick = () => {
                        if (item.source === 'task') {
                          onTaskClick?.(item.raw as unknown as Task & { id?: string });
                        } else {
                          onProjectClick?.(item.raw as unknown as Project & { task_id?: string });
                        }
                      };
                      return (
                        <MobileTaskRow
                          key={item.key}
                          item={item}
                          showDateInline={group.kind !== 'day'}
                          overdue={group.kind === 'overdue'}
                          onClick={handleRowClick}
                          departmentIcon={dept ? DeptIcon : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create task — self-renders fixed inset-0 on mobile. */}
      {creatingOpen && (
        <CreateTaskPanel
          onClose={() => setCreatingOpen(false)}
          onCreated={() => {
            setCreatingOpen(false);
            void fetchAssignments();
          }}
        />
      )}
    </div>
  );
}
