'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTimeline } from '@/lib/useTimeline';
import {
  useExclusiveDetailPanelHost,
  useReservationViewer,
} from '@/lib/reservationViewerContext';
import { cn } from '@/lib/utils';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import type { Task, PropertyOption } from '@/lib/types';
import { DayDetailPanel, type DayDetailReservation } from '@/components/tasks/DayDetailPanel';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import { MobileTaskFilterBar } from '@/components/mobile/MobileTaskFilterBar';
import type { FilterOption } from '@/components/tasks/TaskFilterBar';

const marbleBackground: Record<string, string> = {
  not_started: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.35) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.18) 10%, transparent 40%, rgba(255,255,255,0.12) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #A78BFA`,
  in_progress: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.18) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #6366F1`,
  paused: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #8B7FA8`,
  complete: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.12) 10%, transparent 40%, rgba(255,255,255,0.08) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #4C4869`,
};

// How many task icons fit before collapsing the rest into a "+N" chip.
// Week-only cap (month renders all tasks as wrapped status dots, no cap).
const WEEK_ICON_CAP = 2;

// Stable left-to-right order: timed first (asc), untimed last, then title.
const byScheduleThenTitle = (a: Task, b: Task) => {
  const ta = a.scheduled_time || '';
  const tb = b.scheduled_time || '';
  if (ta && tb && ta !== tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  const na = a.title || a.template_name || 'Task';
  const nb = b.title || b.template_name || 'Task';
  return na.localeCompare(nb);
};

const toDateString = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface MobileTimelineViewProps {
  onCardClick?: (card: any) => void;
  onTaskClick?: (task: any) => void;
  refreshTrigger?: number;
  onSheetOpen?: (open: boolean) => void;
  /**
   * Optional "New task" handler invoked from the day-cell drawer. The
   * parent receives the cell's property name + day so it can resolve a
   * property_id and route to the property's task ledger with the date
   * pre-filled (matches the Property Schedule drawer behavior).
   */
  onNewTask?: (params: { propertyName: string; dateStr: string }) => void;
  onMenuTap?: () => void;
}

export default function MobileTimelineView({
  onCardClick,
  onTaskClick,
  refreshTrigger,
  onSheetOpen,
  onNewTask,
  onMenuTap,
}: MobileTimelineViewProps) {
  const {
    properties,
    loading,
    view,
    setView,
    dateRange,
    goToPrevious,
    goToNext,
    goToToday,
    formatDate,
    isToday,
    getReservationsForProperty,
    getBlockPosition,
    reservations,
    recurringTasks,
    fetchReservations,
  } = useTimeline();
  const { departments } = useDepartments();
  const router = useRouter();

  // Header "+ task" — the general (non-date-specific) new task. Schedule has
  // no local draft flow, so route to the standalone Tasks page with the
  // newTask sentinel; MobileTasksView auto-opens its new-task detail draft
  // (same destination the day-cell drawer's + new task uses, minus the
  // pre-filled date).
  const handleHeaderNewTask = useCallback(() => {
    router.push('/tasks?newTask=1');
  }, [router]);

  // Global reservation viewer — used by the day-cell drawer's
  // "Active reservation(s)" rows so tapping a guest opens the same
  // ReservationDetailOverlay that the desktop timeline + key icon use.
  const { open: openReservationViewer } = useReservationViewer();

  const [expandedCell, setExpandedCell] = useState<{ property: string; dateStr: string } | null>(null);

  // Property catalog → name→id lookup. Used to make the y-axis property
  // labels clickable (open the property's detail page in a new tab).
  // Mirrors the desktop TimelineWindow behavior. Names that don't resolve
  // (orphaned reservation strings) fall back to plain text.
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  useEffect(() => {
    fetch('/api/properties')
      .then(r => r.json())
      .then(result => { if (result.properties) setAllProperties(result.properties); })
      .catch(err => console.error('Error fetching properties:', err));
  }, []);
  const propertyIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allProperties) {
      if (p.id) map.set(p.name, p.id);
    }
    return map;
  }, [allProperties]);

  // Strict single-panel rule (both directions): close our drawer when a
  // context overlay opens; close any active context overlay before
  // opening our drawer so the global doesn't sit on top of the drawer.
  const closeGlobals = useExclusiveDetailPanelHost(() => setExpandedCell(null));

  useEffect(() => {
    onSheetOpen?.(expandedCell !== null);
  }, [expandedCell, onSheetOpen]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchReservations();
    }
  }, [refreshTrigger, fetchReservations]);

  // Mirrors TimelineWindow's synthesis: each task carries its own
  // `reservation_id` FK from the get_property_turnovers RPC payload —
  // it points at the reservation that auto-generated the task, which
  // may NOT be the reservation whose window the task currently appears
  // in. We forward the FK as-is so downstream surfaces (DayDetailPanel,
  // key icon) navigate to the source reservation. Manual / recurring
  // tasks have no FK and render plain.
  const allTasksWithProperty = useMemo(() => {
    const tasks: (Task & {
      property_name: string;
      reservation_id?: string | null;
    })[] = [];
    // Dedupe by task_id (mirrors desktop TimelineWindow): a task can fall in
    // multiple reservation windows or appear in both reservations[].tasks and
    // recurringTasks — without this it renders twice (duplicate React keys).
    const seen = new Set<string>();
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        if (seen.has(task.task_id)) return;
        seen.add(task.task_id);
        tasks.push({
          ...task,
          property_name: res.property_name,
          reservation_id: task.reservation_id ?? null,
        });
      });
    });
    recurringTasks.forEach((task: any) => {
      if (seen.has(task.task_id)) return;
      seen.add(task.task_id);
      tasks.push({
        ...task,
        property_name: task.property_name,
        reservation_id: task.reservation_id ?? null,
      });
    });
    return tasks;
  }, [reservations, recurringTasks]);

  const allScheduledTasks = useMemo(() => {
    return allTasksWithProperty.filter(task => task.scheduled_date);
  }, [allTasksWithProperty]);

  // ---- Filter state + options + predicate (mirrors desktop Schedule) ----
  const NO_DEPT = '__no_department__';
  const [search, setSearch] = useState('');
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [assigneeSel, setAssigneeSel] = useState<Set<string>>(new Set());
  const [deptSel, setDeptSel] = useState<Set<string>>(new Set());
  const [prioritySel, setPrioritySel] = useState<Set<string>>(new Set());
  const [propSel, setPropSel] = useState<Set<string>>(new Set());
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setStatusSel(new Set());
    setAssigneeSel(new Set());
    setDeptSel(new Set());
    setPrioritySel(new Set());
    setPropSel(new Set());
  }, []);
  const anyFilterActive =
    !!search.trim() ||
    statusSel.size +
      assigneeSel.size +
      deptSel.size +
      prioritySel.size +
      propSel.size >
      0;

  const timelineFilterOptions = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const assigneeMap = new Map<string, { name: string; count: number }>();
    const deptMap = new Map<string, { name: string; count: number }>();
    const propertyMap = new Map<string, number>();
    let noDeptCount = 0;
    allScheduledTasks.forEach((t: any) => {
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
      if (t.property_name) propertyMap.set(t.property_name, (propertyMap.get(t.property_name) || 0) + 1);
      (t.assigned_users || []).forEach((a: any) => {
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
  }, [allScheduledTasks]);

  const displayedScheduledTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allScheduledTasks.filter((t: any) => {
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
        if (!(t.assigned_users || []).some((a: any) => assigneeSel.has(a.user_id))) return false;
      }
      if (propSel.size > 0) {
        if (!t.property_name || !propSel.has(t.property_name)) return false;
      }
      return true;
    });
  }, [allScheduledTasks, search, statusSel, assigneeSel, deptSel, prioritySel, propSel]);

  // Property rows shrink to the property filter selection (matches desktop).
  const displayedProperties = useMemo(() => {
    if (propSel.size === 0) return properties;
    return properties.filter((p) => propSel.has(p));
  }, [properties, propSel]);

  const getCellTasks = useCallback((propertyName: string, date: Date) => {
    const dateStr = toDateString(date);
    return displayedScheduledTasks
      .filter(t => t.property_name === propertyName && t.scheduled_date === dateStr)
      .sort(byScheduleThenTitle);
  }, [displayedScheduledTasks]);

  const cellWidth = view === 'week' ? 72 : 38;
  const propertyCellWidth = 130;
  const rowHeight = 36;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-neutral-500 dark:text-neutral-400">Loading timeline...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header region — one continuous neutral gradient behind the title +
          fine print + toolbar row, capped with a hairline where it meets the
          flat grid below. */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)]">
      {/* Title row — matches the Tasks / My Assignments mobile pattern:
          hamburger + page title, then a single controls row underneath. */}
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
            Schedule
          </h1>
        </div>

        {/* Fine print — current date range, matching the Tasks / My
            Assignments supporting line. */}
        {dateRange.length > 0 && (
          <div className="flex items-center gap-3 mt-1 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
            <span>
              {formatDate(dateRange[0])} – {formatDate(dateRange[dateRange.length - 1])}
            </span>
          </div>
        )}
      </div>

      {/* Single controls row: search/filter (swipeable lane) → ‹ Today ›
          nav (pinned, via extraControls) → Week/Month toggle + task (pinned
          right, via trailingControls). The date range lives in the title
          fine print. Background comes from the header-gradient wrapper. */}
      <div>
        <MobileTaskFilterBar
          search={search}
          onSearchChange={setSearch}
          statusOptions={timelineFilterOptions.statuses}
          statusSelected={statusSel}
          onStatusChange={setStatusSel}
          assigneeOptions={timelineFilterOptions.assignees}
          assigneeSelected={assigneeSel}
          onAssigneeChange={setAssigneeSel}
          departmentOptions={timelineFilterOptions.departments}
          departmentSelected={deptSel}
          onDepartmentChange={setDeptSel}
          priorityOptions={timelineFilterOptions.priorities}
          prioritySelected={prioritySel}
          onPriorityChange={setPrioritySel}
          propertyOptions={timelineFilterOptions.propertiesOpt}
          propertySelected={propSel}
          onPropertyChange={setPropSel}
          onClearAll={clearAllFilters}
          anyFilterActive={anyFilterActive}
          onNewTask={handleHeaderNewTask}
          totalCount={allScheduledTasks.length}
          filteredCount={displayedScheduledTasks.length}
          trailingControls={
            <button
              onClick={() => setView(view === 'week' ? 'month' : 'week')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border bg-transparent text-neutral-600 dark:text-[#a09e9a] border-neutral-200 dark:border-[rgba(255,255,255,0.08)] active:opacity-70 transition-opacity"
              aria-label={`Switch to ${view === 'week' ? 'month' : 'week'} view`}
            >
              {view === 'week' ? 'Week' : 'Month'}
            </button>
          }
          extraControls={
            <>
              {/* Date-nav pill — replicates the desktop TimelineNavBar's
                  segmented ‹ │ Today │ › control. */}
              <div className="flex-shrink-0 inline-flex items-stretch rounded-lg border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={goToPrevious}
                  className="px-2 py-1.5 flex items-center text-[#9a9892] dark:text-[#66645f] active:bg-[rgba(30,25,20,0.04)] dark:active:bg-[rgba(255,255,255,0.04)]"
                  aria-label="Previous"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="w-px self-stretch bg-neutral-200 dark:bg-[rgba(255,255,255,0.08)]" />
                <button
                  type="button"
                  onClick={goToToday}
                  className="px-3 py-1.5 text-[13px] font-medium text-[#6b6963] dark:text-[#9a9893] active:bg-[rgba(30,25,20,0.04)] dark:active:bg-[rgba(255,255,255,0.04)]"
                >
                  Today
                </button>
                <span className="w-px self-stretch bg-neutral-200 dark:bg-[rgba(255,255,255,0.08)]" />
                <button
                  type="button"
                  onClick={goToNext}
                  className="px-2 py-1.5 flex items-center text-[#9a9892] dark:text-[#66645f] active:bg-[rgba(30,25,20,0.04)] dark:active:bg-[rgba(255,255,255,0.04)]"
                  aria-label="Next"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </>
          }
        />
      </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto hide-scrollbar overscroll-none">
        <div className="min-w-max overflow-x-clip">
          {/* Date header row */}
          <div className="flex sticky top-0 z-30">
            <div
              className="sticky left-0 z-30 bg-white dark:bg-card border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.06)] px-1.5 py-2 text-xs font-semibold text-[#6b6963] dark:text-[#9a9893] flex items-center"
              style={{ width: propertyCellWidth, minWidth: propertyCellWidth }}
            >
              Property
            </div>
            {dateRange.map((date, idx) => {
              const todayDate = isToday(date);
              return (
                <div
                  key={idx}
                  className={cn(
                    'border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.06)] text-center py-1.5',
                    todayDate
                      ? 'today-tint'
                      : 'bg-white dark:bg-card'
                  )}
                  style={{ width: cellWidth, minWidth: cellWidth }}
                >
                  <div className={cn(
                    'text-[10px] leading-tight',
                    todayDate ? 'text-[#1a1a18] dark:text-[#e8e7e3] font-medium' : 'text-[#6b6963] dark:text-[#9a9893]'
                  )}>
                    {date.toLocaleDateString('en-US', { weekday: view === 'week' ? 'short' : 'narrow' })}
                  </div>
                  <div className={cn(
                    'text-xs leading-tight',
                    todayDate ? 'font-bold text-[#1a1a18] dark:text-[#e8e7e3]' : 'text-[#1a1a18] dark:text-[#e8e7e3]'
                  )}>
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Property rows */}
          {displayedProperties.map((property) => {
            const propReservations = getReservationsForProperty(property);

            return (
              <div key={property}>
              <div className="flex">
                <div
                  className="sticky left-0 z-30 bg-white dark:bg-card border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.06)]"
                  style={{ width: propertyCellWidth, minWidth: propertyCellWidth, height: rowHeight }}
                >
                  <div
                    className="relative overflow-hidden w-full h-full px-1.5 text-xs font-medium text-[#1a1a18] dark:text-[#e8e7e3] flex items-center"
                  >
                    {(() => {
                      const propertyId = propertyIdByName.get(property);
                      return propertyId ? (
                        <Link
                          href={`/properties/${propertyId}`}
                          className="truncate cursor-pointer"
                        >
                          {property}
                        </Link>
                      ) : (
                        <span className="truncate">{property}</span>
                      );
                    })()}
                  </div>
                </div>

                {/* Date cells */}
                {dateRange.map((date, idx) => {
                  const todayDate = isToday(date);
                  const startingRes = propReservations.find(res => {
                    const { start } = getBlockPosition(res.check_in, res.check_out);
                    return start === idx;
                  });

                  const cellTasks = getCellTasks(property, date);
                  const hasItems = cellTasks.length > 0;

                  return (
                    <div
                      key={idx}
                      className={cn(
                        'border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.06)] relative overflow-visible cursor-pointer',
                        todayDate ? 'today-tint' : 'bg-white dark:bg-card'
                      )}
                      style={{ width: cellWidth, minWidth: cellWidth, height: rowHeight }}
                      onClick={() => {
                        // Every cell — empty or not — opens the day-drawer
                        // for this property + date. The drawer's empty
                        // state surfaces the "New task" CTA, mirroring
                        // the property-calendar behavior on empty days.
                        // closeGlobals() runs in the event handler (not
                        // inside the updater) so it doesn't fire during
                        // React's render phase.
                        const dateStr = toDateString(date);
                        const isSameCell =
                          expandedCell?.property === property &&
                          expandedCell?.dateStr === dateStr;
                        if (isSameCell) {
                          setExpandedCell(null);
                          return;
                        }
                        closeGlobals();
                        setExpandedCell({ property, dateStr });
                      }}
                    >
                      {startingRes && (() => {
                        const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingRes.check_in, startingRes.check_out);
                        const reachesLastColumn = idx + span >= dateRange.length;
                        const flushRight = endsAfterRange || reachesLastColumn;

                        const leftOffset = startsBeforeRange ? 0 : 50;
                        const rightOffset = flushRight ? 0 : 50;
                        const totalWidth = (span * 100) - leftOffset - rightOffset;
                        const widthValue = flushRight ? `${totalWidth + 20}%` : `${totalWidth}%`;

                        const diagonalPx = view === 'week' ? 10 : 5;
                        const leftDiag = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                        const rightDiag = flushRight ? '0px' : `${diagonalPx}px`;
                        const clipPath = `polygon(${leftDiag} 0%, 100% 0%, calc(100% - ${rightDiag}) 100%, 0% 100%)`;

                        const borderRadius = `${startsBeforeRange ? '0' : '8'}px ${flushRight ? '0' : '8'}px ${flushRight ? '0' : '8'}px ${startsBeforeRange ? '0' : '8'}px`;

                        // Reservation bar color — single shared lavender,
                        // sourced from --turnover-purple-* tokens so this
                        // bar matches TurnoverCards + the desktop Timeline +
                        // the property Schedule MonthGrid in both themes.
                        const bgClass =
                          'bg-[var(--turnover-purple-bg)] border-[var(--turnover-purple-border)]';

                        return (
                          <div
                            className={cn(
                              'absolute pointer-events-none text-[#1a1a18] dark:text-[#e8e7e3] text-[11px] font-medium flex items-center overflow-hidden border-t',
                              bgClass
                            )}
                            style={{
                              left: `${leftOffset}%`,
                              top: 6,
                              height: 24,
                              width: widthValue,
                              zIndex: 15,
                              clipPath,
                              borderRadius,
                            }}
                            title={startingRes.guest_name || 'No guest'}
                          >
                            {!startsBeforeRange && (
                              <span
                                className="truncate whitespace-nowrap"
                                style={{ paddingLeft: `${diagonalPx + 3}px`, paddingRight: `${diagonalPx + 3}px` }}
                              >
                                {startingRes.guest_name || 'No guest'}
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      {hasItems && view === 'month' && (
                        // Month: status dots (all tasks, wrap). No hover on
                        // mobile — the cell's onClick opens the bottom sheet
                        // (full list); dots are pure indicators.
                        <div className="absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap items-end gap-0.5 z-[5]">
                          {cellTasks.map((task) => {
                            const isContingent = task.status === 'contingent';
                            return (
                              <span
                                key={task.task_id}
                                className={cn(
                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                  isContingent &&
                                    'border border-dashed border-[rgba(30,25,20,0.4)] dark:border-[rgba(255,255,255,0.4)]',
                                )}
                                style={
                                  isContingent
                                    ? undefined
                                    : { background: marbleBackground[task.status] || marbleBackground.not_started }
                                }
                              />
                            );
                          })}
                        </div>
                      )}

                      {hasItems && view === 'week' && (() => {
                        const visible = cellTasks.slice(0, WEEK_ICON_CAP);
                        const overflow = cellTasks.length - visible.length;
                        const box = 'w-[22px] h-[22px]';
                        const glyph = 'w-3 h-3';
                        return (
                          <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 z-[5]">
                            {visible.map((task) => {
                              const dept = departments.find((d) => d.id === task.department_id);
                              const Icon = getDepartmentIcon(dept?.icon);
                              const isContingent = task.status === 'contingent';
                              return (
                                <div
                                  key={task.task_id}
                                  className={cn(
                                    'flex items-center justify-center rounded shadow-sm transition-all overflow-hidden text-white',
                                    box,
                                    isContingent &&
                                      'border-[1.5px] border-dashed border-[rgba(30,25,20,0.25)] dark:border-[rgba(255,255,255,0.35)] bg-white dark:bg-[#1a1a1d] text-[#1a1a18] dark:text-white',
                                  )}
                                  style={
                                    isContingent
                                      ? undefined
                                      : { background: marbleBackground[task.status] || marbleBackground.not_started }
                                  }
                                >
                                  <Icon className={glyph} />
                                </div>
                              );
                            })}
                            {overflow > 0 && (
                              <div
                                className={cn(
                                  'flex items-center justify-center rounded px-0.5 font-medium text-[8px] shadow-sm',
                                  'bg-white/90 dark:bg-[#1a1a1d] text-[#1a1a18] dark:text-white border border-[rgba(30,25,20,0.12)] dark:border-[rgba(255,255,255,0.12)]',
                                  box,
                                )}
                              >
                                +{overflow}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom-sheet drawer for expanded cell items.
          Reuses DayDetailPanel for parity with the property-calendar
          drawer: same row design (MobileTaskRow), same "New task"
          shortcut, same header layout. The drawer wrapper supplies the
          backdrop + bottom-anchored sheet styling. */}
      {expandedCell && (() => {
        const date = new Date(expandedCell.dateStr + 'T00:00:00');
        const cellTasks = getCellTasks(expandedCell.property, date);

        // Active reservation(s) covering this cell. Range is inclusive on
        // both ends (check_in <= dateStr <= check_out) so a same-day flip
        // surfaces both the outgoing reservation (whose check_out === today)
        // and the incoming one (whose check_in === today). Sorted by
        // check_in asc → outgoing first, then incoming.
        // isCheckIn / isCheckOut flags drive the diagonal-cut row geometry
        // in DayDetailPanel: left cut for check-in day, right cut for
        // check-out day, flat for mid-stay.
        const activeReservations: DayDetailReservation[] = (
          getReservationsForProperty(expandedCell.property) as Array<{
            id: string;
            guest_name?: string | null;
            check_in?: string | null;
            check_out?: string | null;
          }>
        )
          .filter((r) => {
            const ci = r.check_in?.slice(0, 10);
            const co = r.check_out?.slice(0, 10);
            if (!ci || !co) return false;
            return ci <= expandedCell.dateStr && expandedCell.dateStr <= co;
          })
          .sort((a, b) => {
            const ai = a.check_in?.slice(0, 10) || '';
            const bi = b.check_in?.slice(0, 10) || '';
            return ai.localeCompare(bi);
          })
          .map((r) => ({
            id: r.id,
            guest_name: r.guest_name ?? null,
            isCheckIn: r.check_in?.slice(0, 10) === expandedCell.dateStr,
            isCheckOut: r.check_out?.slice(0, 10) === expandedCell.dateStr,
          }));

        const dayTasks: TaskRowItem[] = cellTasks.map((t) => ({
          key: t.task_id,
          title: t.title || t.template_name || 'Task',
          property_name: t.property_name || expandedCell.property,
          status: t.status || 'not_started',
          priority: t.priority || 'medium',
          department_id: t.department_id ?? null,
          department_name: t.department_name ?? null,
          scheduled_date: t.scheduled_date ?? null,
          scheduled_time: t.scheduled_time ?? null,
          assignees: (t.assigned_users || []).map((u) => ({
            user_id: u.user_id,
            name: u.name,
            avatar: u.avatar ?? null,
          })),
          bin_id: (t as Task & { bin_id?: string | null }).bin_id ?? null,
          bin_name: (t as Task & { bin_name?: string | null }).bin_name ?? null,
          is_binned: !!(t as Task & { is_binned?: boolean }).is_binned,
          is_automated: (t as Task & { is_automated?: boolean }).is_automated,
          reservation_id: (t as Task).reservation_id ?? null,
        }));

        const handleTaskClickFromDrawer = (taskKey: string) => {
          const t = cellTasks.find((x) => x.task_id === taskKey);
          if (!t) return;
          setExpandedCell(null);
          onTaskClick?.(t);
        };

        return (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/20 dark:bg-black/40"
              onClick={() => setExpandedCell(null)}
            />
            <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-background border-t border-[rgba(30,25,20,0.08)] dark:border-white/10 rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col">
              <DayDetailPanel
                date={date}
                title={expandedCell.property}
                onClose={() => setExpandedCell(null)}
                tasks={dayTasks}
                onTaskClick={handleTaskClickFromDrawer}
                activeReservations={activeReservations}
                onReservationClick={(reservationId) => {
                  setExpandedCell(null);
                  openReservationViewer(reservationId);
                }}
                onNewTask={
                  onNewTask
                    ? (dateStr) => {
                        const property = expandedCell.property;
                        setExpandedCell(null);
                        onNewTask({ propertyName: property, dateStr });
                      }
                    : undefined
                }
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
