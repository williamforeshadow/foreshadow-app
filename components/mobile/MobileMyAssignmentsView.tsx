'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { KeyAffordance } from '@/components/tasks/KeyAffordance';
import { useAuth } from '@/lib/authContext';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { STATUS_ICONS, STATUS_TITLE } from '@/lib/taskStatusIcons';
import { PRIORITY_ICONS, PRIORITY_TITLE } from '@/lib/taskPriorityIcons';
import type { Project, Task } from '@/lib/types';
import { MobileTaskFilterBar } from '@/components/mobile/MobileTaskFilterBar';
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
  raw: AssignmentRaw;
}

interface DateGroup {
  label: string;
  sublabel?: string;
  items: UnifiedItem[];
}

interface MobileMyAssignmentsViewProps {
  onTaskClick?: BivariantCallback<Task & { id?: string }>;
  onProjectClick?: BivariantCallback<Project & { task_id?: string }>;
  refreshTrigger?: number;
  onMenuTap?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  not_started: '#A78BFA',
  in_progress: '#6366F1',
  paused: '#8B7FA8',
  complete: '#4C4869',
};

const STATUS_MARBLE: Record<string, string> = {
  not_started: 'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.35) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.18) 10%, transparent 40%, rgba(255,255,255,0.12) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #A78BFA',
  in_progress: 'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.18) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #6366F1',
  paused: 'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #8B7FA8',
  complete: 'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.12) 10%, transparent 40%, rgba(255,255,255,0.08) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #4C4869',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function PriorityTag({ priority }: { priority: string }) {
  if (!priority || priority === 'low') return null;
  const colorClass =
    priority === 'urgent'
      ? 'text-red-500 dark:text-[#d97757]'
      : priority === 'high'
        ? 'text-neutral-800 dark:text-[#f0efed]'
        : 'text-neutral-500 dark:text-[#a09e9a]';
  const PriorityIcon = PRIORITY_ICONS[priority] ?? PRIORITY_ICONS.medium;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10.5px] tracking-[0.02em] font-medium pl-2 border-l border-neutral-200 dark:border-[rgba(255,255,255,0.07)] ${colorClass}`}
      title={PRIORITY_TITLE[priority] ?? priority}
    >
      <PriorityIcon size={12} strokeWidth={2} aria-hidden />
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
};

export default function MobileMyAssignmentsView({
  onTaskClick,
  onProjectClick,
  refreshTrigger,
  onMenuTap,
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
  // "+ New task" hands off to the standalone mobile Tasks page, which
  // auto-opens its new-task draft detail when the `newTask=1` sentinel is
  // present.
  const handleNewTask = useCallback(() => {
    router.push('/tasks?newTask=1');
  }, [router]);
  const [rawData, setRawData] = useState<{ tasks: RawTask[]; projects: RawProject[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const fetchAssignments = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/my-assignments?user_id=${user.id}`);
      const result = await response.json() as {
        error?: string;
        tasks?: RawTask[];
        projects?: RawProject[];
      };
      if (!response.ok) throw new Error(result.error || 'Failed to fetch assignments');
      setRawData({ tasks: result.tasks || [], projects: result.projects || [] });
    } catch (err) {
      console.error('Error fetching assignments:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch assignments');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) fetchAssignments();
  }, [user?.id, refreshTrigger, fetchAssignments]);

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

  const { groups, todayTurnoverCount, openCount } = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const endOfWeek = new Date(now);
    const dayOfWeek = now.getDay();
    const daysUntilSunday = 7 - dayOfWeek;
    endOfWeek.setDate(now.getDate() + daysUntilSunday);
    const endOfWeekStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, '0')}-${String(endOfWeek.getDate()).padStart(2, '0')}`;

    const overdue: UnifiedItem[] = [];
    const today: UnifiedItem[] = [];
    const thisWeek: UnifiedItem[] = [];
    const later: UnifiedItem[] = [];
    const unscheduled: UnifiedItem[] = [];
    let turnoverCount = 0;
    let open = 0;

    for (const item of filteredItems) {
      if (item.status === 'complete') continue;
      open++;
      const d = item.scheduled_date;
      if (!d) {
        unscheduled.push(item);
      } else if (d === todayStr) {
        today.push(item);
        // "Turnover" badge counts reservation-bound tasks scheduled today —
        // turnovers are the only path that produces reservation_id-linked
        // tasks, regardless of which template/department spawned them.
        if (item.raw?.reservation_id) turnoverCount++;
      } else if (d > todayStr && d <= endOfWeekStr) {
        thisWeek.push(item);
      } else if (d > endOfWeekStr) {
        later.push(item);
      } else {
        overdue.push(item);
      }
    }

    // Within-group sort honors the user-selected SortKey / SortDir from
    // the filter bar. Outer grouping (overdue / today / this week / later
    // / no date) is structural and not user-configurable.
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
    overdue.sort(compareItems);
    today.sort(compareItems);
    thisWeek.sort(compareItems);
    later.sort(compareItems);
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

    return { groups: result, todayTurnoverCount: turnoverCount, openCount: open };
  }, [filteredItems, sortKey, sortDir]);

  const formatTimeCol = (timeString?: string | null) => {
    if (!timeString) return null;
    const [h, m] = timeString.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return { time: `${hour12}:${String(m).padStart(2, '0')}`, meridiem: ampm };
  };

  const getDayLabel = (dateStr?: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  };

  const getShortDate = (dateStr?: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr + 'T00:00:00');
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return { month, day: date.getDate() };
  };

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
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin mb-3" />
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
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-6">
        <p className="text-neutral-600 dark:text-[#a09e9a] text-center text-sm mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchAssignments}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header region — one continuous neutral gradient behind the title,
          fine print + toolbar, capped with a hairline where it meets the
          content below. */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)]">
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
          <h1 className="text-[20px] font-semibold tracking-tight leading-none text-neutral-900 dark:text-[#f0efed] truncate">
            My Assignments
          </h1>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
          <span>{todayFormatted}</span>
          <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
          <span>{openCount} open</span>
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
      <div className="flex-1 overflow-auto hide-scrollbar">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-6">
            <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No tasks assigned</p>
            <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">You are all caught up</p>
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsedSections.has(group.label);
            return (
            <div key={group.label} className="px-[22px] pt-5">
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
                  const timeInfo = formatTimeCol(item.scheduled_time);
                  const dayLabel = getDayLabel(item.scheduled_date);
                  const dept = allDepts.find(d => d.id === item.department_id);
                  const DeptIcon = getDepartmentIcon(dept?.icon);

                  const handleRowClick = () => {
                    if (item.source === 'task') {
                      onTaskClick?.(item.raw as unknown as Task & { id?: string });
                    } else {
                      onProjectClick?.(item.raw as unknown as Project & { task_id?: string });
                    }
                  };
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={item.key}
                      onClick={handleRowClick}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRowClick();
                        }
                      }}
                      className={`grid grid-cols-[44px_1fr] gap-3.5 py-3.5 text-left transition-colors cursor-pointer active:bg-neutral-100/50 dark:active:bg-[rgba(255,255,255,0.03)] ${
                        idx < group.items.length - 1 ? 'border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)]' : ''
                      }`}
                    >
                      {/* Time column — show all available date/time info */}
                      <div className="text-right pt-0.5">
                        {item.scheduled_date || timeInfo ? (
                          <>
                            {item.scheduled_date && (() => {
                              const sd = getShortDate(item.scheduled_date);
                              return sd ? (
                                <>
                                  {dayLabel && (
                                    <div className="text-[9px] text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.06em] font-medium mb-0.5">{dayLabel}</div>
                                  )}
                                  <div className="text-[12px] font-semibold text-neutral-800 dark:text-[#f0efed] leading-none tracking-tight whitespace-nowrap">{sd.month} {sd.day}</div>
                                </>
                              ) : null;
                            })()}
                            {timeInfo && (
                              <div className={item.scheduled_date ? 'mt-1' : ''}>
                                <div className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] leading-none tracking-tight tabular-nums whitespace-nowrap">
                                  {timeInfo.time}{timeInfo.meridiem.toLowerCase()}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-[9px] text-neutral-300 dark:text-[#3e3d3a] uppercase tracking-[0.08em] font-medium leading-snug pt-0.5">
                            no<br />date
                          </div>
                        )}
                      </div>

                      {/* Body */}
                      <div className="min-w-0">
                        {/* Title row with dept icon on right */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
                            <div className="text-[14.5px] font-medium text-neutral-800 dark:text-[#f0efed] leading-snug tracking-tight line-clamp-2 min-w-0">
                              {item.title}
                            </div>
                            <KeyAffordance reservationId={item.reservation_id} size={12} />

                          </div>
                          {dept && (
                            <DeptIcon className="w-[15px] h-[15px] text-neutral-400 dark:text-[#66645f] shrink-0 mt-0.5" />
                          )}
                        </div>
                        {item.property_name && (
                          <div className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug truncate">
                            {item.property_name}
                          </div>
                        )}
                        {/* Metadata row: status icon + label, priority, avatars */}
                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className="inline-flex items-center gap-1 text-[10.5px] tracking-[0.02em] font-medium"
                            style={{ color: STATUS_COLORS[item.status] || '#A78BFA' }}
                            title={STATUS_TITLE[item.status] ?? item.status}
                          >
                            {(() => {
                              const StatusIcon = STATUS_ICONS[item.status] ?? STATUS_ICONS.not_started;
                              return <StatusIcon size={12} strokeWidth={2} aria-hidden />;
                            })()}
                            {STATUS_LABELS[item.status] || item.status}
                          </span>
                          <PriorityTag priority={item.priority} />
                          {item.assignees.length > 0 && (
                            <div className="flex ml-auto">
                              {item.assignees.slice(0, 3).map((u, i) => (
                                <div
                                  key={u.user_id}
                                  className="w-[20px] h-[20px] rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[8px] font-semibold text-neutral-600 dark:text-[#a09e9a] overflow-hidden ring-[1.5px] ring-white dark:ring-background"
                                  style={{ marginLeft: i > 0 ? '-6px' : 0 }}
                                  title={u.name}
                                >
                                  {u.avatar ? (
                                    <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" />
                                  ) : (
                                    u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
