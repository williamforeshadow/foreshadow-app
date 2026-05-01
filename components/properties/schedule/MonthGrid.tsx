'use client';

import React, { useMemo } from 'react';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ClipboardCheck } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { marbleBackground } from '@/components/windows/timeline/ScheduledItemsCell';
import { useIsMobile } from '@/lib/useIsMobile';

// ---- Types ---------------------------------------------------------------

export interface ScheduleReservation {
  id: string;
  guest_name: string | null;
  check_in: string; // YYYY-MM-DD or ISO
  check_out: string;
  next_check_in?: string | null;
}

export interface ScheduleTaskAssignee {
  user_id: string;
  name: string;
  avatar: string | null;
  role?: string;
}

export interface ScheduleTask {
  task_id: string;
  title: string | null;
  template_name: string | null;
  scheduled_date: string | null; // YYYY-MM-DD
  scheduled_time: string | null;
  status: string;
  reservation_id: string | null;
  is_automated?: boolean;
  assigned_users?: ScheduleTaskAssignee[];
  // Extended fields — populated by /api/properties/[id]/schedule so that
  // clicking a task pill can open the full ProjectDetailPanel without a
  // second fetch.
  property_id?: string | null;
  property_name?: string | null;
  template_id?: string | null;
  description?: unknown;
  priority?: string;
  department_id?: string | null;
  department_name?: string | null;
  form_metadata?: Record<string, unknown> | null;
  bin_id?: string | null;
  bin_name?: string | null;
  is_binned?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface MonthGridProps {
  monthDate: Date; // any date within the month to render
  reservations: ScheduleReservation[];
  tasks: ScheduleTask[];
  selectedReservationId?: string | null;
  selectedDayKey?: string | null; // YYYY-MM-DD of the currently-open day panel
  onReservationClick?: (reservation: ScheduleReservation) => void;
  onTaskClick?: (task: ScheduleTask) => void;
  onDayClick?: (day: Date) => void;
}

// ---- Helpers -------------------------------------------------------------

function toDateOnly(raw: string): Date {
  // Reservation dates come as YYYY-MM-DD strings or ISO timestamps. We always
  // want the local-day, so slice + parse explicitly to dodge timezone shifts.
  const justDate = raw.length >= 10 ? raw.slice(0, 10) : raw;
  return parseISO(`${justDate}T00:00:00`);
}

function compareYMD(a: Date, b: Date): number {
  const au = a.getFullYear() * 10000 + (a.getMonth() + 1) * 100 + a.getDate();
  const bu = b.getFullYear() * 10000 + (b.getMonth() + 1) * 100 + b.getDate();
  return au - bu;
}

// Aggregate status for a group of tasks scheduled on the same day.
// Mirrors the mobile-Timeline / ScheduledItemsCell folder logic so the
// single-icon mobile view here reads identically.
function getFolderStatus(
  items: ScheduleTask[]
): 'not_started' | 'in_progress' | 'paused' | 'complete' | 'no_tasks' {
  const active = items.filter((t) => t.status !== 'contingent');
  if (active.length === 0) return 'no_tasks';
  const completed = active.filter((t) => t.status === 'complete').length;
  if (completed === active.length) return 'complete';
  const inProgress = active.filter((t) => t.status === 'in_progress').length;
  if (inProgress > 0) return 'in_progress';
  const paused = active.filter((t) => t.status === 'paused').length;
  if (paused > 0 || completed > 0) return 'paused';
  return 'not_started';
}

// For each week row, we lay reservation bars horizontally. This function
// computes, for each week, which reservations intersect it and at which
// column span (0..6 inclusive). We also compute a vertical "lane" per bar
// within the week so bars don't overlap visually.
interface WeekBar {
  reservation: ScheduleReservation;
  startCol: number; // 0..6, inclusive
  endCol: number; // 0..6, inclusive
  startsBefore: boolean; // bar starts before this week's first day
  endsAfter: boolean; // bar ends after this week's last day
  lane: number;
}

function computeWeekBars(
  weekDays: Date[],
  reservations: ScheduleReservation[]
): { bars: WeekBar[]; laneCount: number } {
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const intersecting: WeekBar[] = [];

  for (const r of reservations) {
    const ci = toDateOnly(r.check_in);
    const co = toDateOnly(r.check_out);
    if (compareYMD(co, weekStart) < 0) continue;
    if (compareYMD(ci, weekEnd) > 0) continue;
    const startsBefore = compareYMD(ci, weekStart) < 0;
    const endsAfter = compareYMD(co, weekEnd) > 0;
    const startCol = startsBefore
      ? 0
      : weekDays.findIndex((d) => isSameDay(d, ci));
    const endCol = endsAfter
      ? 6
      : weekDays.findIndex((d) => isSameDay(d, co));
    if (startCol < 0 || endCol < 0) continue;
    intersecting.push({
      reservation: r,
      startCol,
      endCol,
      startsBefore,
      endsAfter,
      lane: 0,
    });
  }

  // Greedy lane assignment: sort by start, place in the first lane where
  // the previous bar has already ended. `<=` (instead of `<`) lets a
  // same-day turnover share a lane — the parallelogram clip-path gives the
  // outgoing bar the left half of the shared day and the incoming bar the
  // right half, matching Timeline's handover visual.
  intersecting.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return b.endCol - a.endCol; // longer first on ties (looks tidier)
  });
  const laneEnds: number[] = []; // lane index → last endCol occupied
  for (const bar of intersecting) {
    let placed = false;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= bar.startCol) {
        bar.lane = i;
        laneEnds[i] = bar.endCol;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bar.lane = laneEnds.length;
      laneEnds.push(bar.endCol);
    }
  }

  return { bars: intersecting, laneCount: laneEnds.length };
}

// ---- Component -----------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BAR_HEIGHT = 24; // px — matches Timeline's bar feel, compressed for month density
const BAR_GAP = 3; // px
const BAR_TRACK_OFFSET = 28; // px from top of cell (leaves room for day number)
const BAR_DIAGONAL_PX = 12; // px — parallelogram slant, same as Timeline
const MAX_BARS_PER_WEEK = 3;
const MAX_TASKS_PER_CELL = 2;
const TASK_CARD_HEIGHT = 22; // px — matches tighter calendar task card

export function MonthGrid({
  monthDate,
  reservations,
  tasks,
  selectedReservationId,
  selectedDayKey,
  onReservationClick,
  onTaskClick,
  onDayClick,
}: MonthGridProps) {
  const isMobile = useIsMobile();

  // Build the 6-week grid (always 42 days for consistent layout).
  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = gridStart;
    while (compareYMD(d, gridEnd) <= 0) {
      days.push(d);
      d = addDays(d, 1);
    }
    // Pad to exactly 42 days (6 weeks) so the grid height is stable.
    while (days.length < 42) days.push(addDays(days[days.length - 1], 1));
    const weekChunks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weekChunks.push(days.slice(i, i + 7));
    }
    return weekChunks;
  }, [monthDate]);

  // Index tasks by YYYY-MM-DD for fast per-cell lookup.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, ScheduleTask[]>();
    for (const t of tasks) {
      if (!t.scheduled_date) continue;
      const key = t.scheduled_date.slice(0, 10);
      const bucket = map.get(key) || [];
      bucket.push(t);
      map.set(key, bucket);
    }
    // Deterministic order inside a day: by scheduled_time, then title.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.scheduled_time || '';
        const tb = b.scheduled_time || '';
        if (ta !== tb) return ta.localeCompare(tb);
        return (a.title || a.template_name || '').localeCompare(
          b.title || b.template_name || ''
        );
      });
    }
    return map;
  }, [tasks]);

  // Pre-compute bars + required lane count for each week so we can size
  // each week row to accommodate its bars.
  const weekLayouts = useMemo(
    () => weeks.map((w) => computeWeekBars(w, reservations)),
    [weeks, reservations]
  );

  const today = new Date();

  return (
    <div className="flex flex-col">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)]">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-[10px] italic font-medium tracking-[0.04em] text-neutral-400 dark:text-[#66645f] uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex flex-col">
        {weeks.map((weekDays, weekIdx) => {
          const { bars, laneCount } = weekLayouts[weekIdx];
          const visibleBars = bars.filter((b) => b.lane < MAX_BARS_PER_WEEK);
          const hiddenCountByCol: Record<number, number> = {};
          for (const b of bars) {
            if (b.lane >= MAX_BARS_PER_WEEK) {
              for (let c = b.startCol; c <= b.endCol; c++) {
                hiddenCountByCol[c] = (hiddenCountByCol[c] || 0) + 1;
              }
            }
          }

          const renderedLanes = Math.min(laneCount, MAX_BARS_PER_WEEK);
          const barsBlockHeight =
            renderedLanes * BAR_HEIGHT + Math.max(0, renderedLanes - 1) * BAR_GAP;

          // Minimum cell height: day number + bars block + task region + padding.
          // Desktop reserves room for two full task pill rows; mobile only
          // needs room for the single folder icon (~22px).
          const taskRegionHeight = isMobile
            ? 22 + 6
            : MAX_TASKS_PER_CELL * (TASK_CARD_HEIGHT + 4) + 12;
          const minCellFloor = isMobile ? 84 : 124;
          const minCellHeight = Math.max(
            minCellFloor,
            BAR_TRACK_OFFSET +
              barsBlockHeight +
              (barsBlockHeight > 0 ? 8 : 0) +
              taskRegionHeight
          );

          return (
            <div
              key={weekIdx}
              className="relative grid grid-cols-7 border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)] last:border-b-0"
              style={{ minHeight: minCellHeight }}
            >
              {/* Day cells */}
              {weekDays.map((day) => {
                const inMonth = isSameMonth(day, monthDate);
                const isToday = isSameDay(day, today);
                const dayKey = format(day, 'yyyy-MM-dd');
                const cellTasks = tasksByDay.get(dayKey) || [];
                const taskOverflow = Math.max(
                  0,
                  cellTasks.length - MAX_TASKS_PER_CELL
                );
                const hiddenBarCount = hiddenCountByCol[day.getDay()] || 0;

                const isSelectedDay = selectedDayKey === dayKey;
                return (
                  <div
                    key={day.toISOString()}
                    onClick={() => onDayClick?.(day)}
                    className={`group relative border-r border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)] last:border-r-0 cursor-pointer transition-colors ${
                      inMonth ? '' : 'bg-[rgba(30,25,20,0.015)] dark:bg-[rgba(255,255,255,0.015)]'
                    } ${
                      isSelectedDay
                        ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)]'
                        : 'hover:bg-[rgba(30,25,20,0.025)] dark:hover:bg-[rgba(255,255,255,0.02)]'
                    }`}
                  >
                    {/* Day number */}
                    <div className="flex items-center justify-between px-2 pt-2">
                      <div
                        className={`flex items-center justify-center w-[22px] h-[22px] rounded-full text-[12px] font-medium tabular-nums ${
                          isToday
                            ? 'bg-[var(--accent-3)] text-white dark:bg-[var(--accent-1)] dark:text-[#0b0b0c]'
                            : inMonth
                              ? 'text-neutral-700 dark:text-[#e5e4e2]'
                              : 'text-neutral-300 dark:text-[#3e3d3a]'
                        }`}
                      >
                        {day.getDate()}
                      </div>
                      {hiddenBarCount > 0 && (
                        <span
                          className="text-[10px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)]"
                          title={`${hiddenBarCount} more reservation${hiddenBarCount === 1 ? '' : 's'}`}
                        >
                          +{hiddenBarCount}
                        </span>
                      )}
                    </div>

                    {/* Task region.
                        Desktop: up to MAX_TASKS_PER_CELL marble pills with
                                 title + assignee, "+N more" overflow. Each
                                 pill is its own click target → opens the
                                 task overlay directly.
                        Mobile:  a single ClipboardCheck folder icon tinted
                                 by aggregate status, mirroring
                                 MobileTimelineView. The cell's own onClick
                                 already routes to onDayClick → fullscreen
                                 DayDetailPanel, so the icon doesn't need
                                 its own handler. */}
                    {isMobile ? (
                      cellTasks.length > 0 && (() => {
                        const folderStatus = getFolderStatus(cellTasks);
                        const hasActive = folderStatus !== 'no_tasks';
                        const hasContingent = cellTasks.some(
                          (t) => t.status === 'contingent'
                        );
                        const onlyContingent = !hasActive && hasContingent;
                        return (
                          <div
                            className="absolute left-1.5 flex items-center gap-0.5 pointer-events-none"
                            style={{
                              top:
                                BAR_TRACK_OFFSET +
                                barsBlockHeight +
                                (barsBlockHeight > 0 ? 6 : 0),
                            }}
                          >
                            <div
                              className={`flex items-center justify-center w-[18px] h-[18px] rounded shadow-sm ${
                                onlyContingent
                                  ? 'bg-white dark:bg-[#1a1a1d] border-[1.5px] border-dashed border-[rgba(30,25,20,0.25)] dark:border-[rgba(255,255,255,0.25)] text-[#1a1a18] dark:text-[#e8e7e3]'
                                  : hasActive && hasContingent
                                    ? 'border-[1.5px] border-dashed border-[rgba(30,25,20,0.35)] dark:border-[rgba(255,255,255,0.35)] text-white'
                                    : 'text-white'
                              }`}
                              style={
                                hasActive
                                  ? {
                                      background:
                                        marbleBackground[folderStatus] ||
                                        marbleBackground.not_started,
                                    }
                                  : undefined
                              }
                            >
                              <ClipboardCheck className="w-3 h-3" />
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div
                        className="absolute left-1.5 right-1.5 flex flex-col gap-1"
                        style={{
                          top:
                            BAR_TRACK_OFFSET +
                            barsBlockHeight +
                            (barsBlockHeight > 0 ? 6 : 0),
                        }}
                      >
                        {cellTasks.slice(0, MAX_TASKS_PER_CELL).map((t) => {
                          const isContingent = t.status === 'contingent';
                          const marble =
                            marbleBackground[t.status] ||
                            marbleBackground.not_started;
                          const firstUser = t.assigned_users?.[0];
                          const overflowAssignees =
                            (t.assigned_users?.length ?? 0) - 1;
                          return (
                            <button
                              key={t.task_id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onTaskClick?.(t);
                              }}
                              title={t.title || t.template_name || 'Task'}
                              style={
                                isContingent
                                  ? undefined
                                  : { background: marble }
                              }
                              className={`flex items-center justify-between gap-1.5 py-1 px-1.5 rounded-md text-[11px] leading-tight font-medium text-left relative overflow-hidden shadow-sm transition-all duration-150 hover:shadow-md ${
                                isContingent
                                  ? 'bg-white dark:bg-[#1a1a1d] border-[1.5px] border-dashed border-[rgba(30,25,20,0.25)] dark:border-[rgba(255,255,255,0.25)] text-[#1a1a18] dark:text-[#e8e7e3]'
                                  : 'text-white'
                              }`}
                            >
                              <span className="truncate flex-1">
                                {t.title || t.template_name || 'Task'}
                              </span>
                              {firstUser && (
                                <div className="relative shrink-0">
                                  <UserAvatar
                                    src={firstUser.avatar || undefined}
                                    name={firstUser.name || 'Unknown'}
                                    size="xs"
                                  />
                                  {overflowAssignees > 0 && (
                                    <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-neutral-700 dark:bg-neutral-200 text-[9px] font-medium text-white dark:text-neutral-800 border border-white dark:border-neutral-900">
                                      +{overflowAssignees}
                                    </div>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                        {taskOverflow > 0 && (
                          <div className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] pl-1">
                            +{taskOverflow} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Reservation bars overlay — mirrors Timeline's bar shape:
                  half-day offset on check-in / check-out days + a 12px
                  parallelogram clip-path so two reservations sharing the
                  same turnover day can sit inline on one lane. Tinted
                  purple bg with matching border (not_started palette). */}
              <div className="pointer-events-none absolute inset-0">
                {visibleBars.map((bar) => {
                  const r = bar.reservation;
                  const top =
                    BAR_TRACK_OFFSET + bar.lane * (BAR_HEIGHT + BAR_GAP);
                  const isSelected = selectedReservationId === r.id;

                  // Half-day offsets (as % of the week row). One day column
                  // = 100/7 %, so half a day = 50/7 %.
                  const colPct = 100 / 7;
                  const halfDayPct = colPct * 0.5;
                  const leftPct = (bar.startCol / 7) * 100;
                  const spanPct =
                    ((bar.endCol - bar.startCol + 1) / 7) * 100;
                  const leftOffsetPct = bar.startsBefore ? 0 : halfDayPct;
                  const rightOffsetPct = bar.endsAfter ? 0 : halfDayPct;

                  const leftDiag = bar.startsBefore
                    ? '0px'
                    : `${BAR_DIAGONAL_PX}px`;
                  const rightDiag = bar.endsAfter
                    ? '0px'
                    : `${BAR_DIAGONAL_PX}px`;
                  const clipPath = `polygon(${leftDiag} 0%, 100% 0%, calc(100% - ${rightDiag}) 100%, 0% 100%)`;

                  const borderRadius =
                    bar.startsBefore && bar.endsAfter
                      ? 0
                      : bar.startsBefore
                        ? '0 8px 8px 0'
                        : bar.endsAfter
                          ? '8px 0 0 8px'
                          : '8px';

                  return (
                    <button
                      key={`${weekIdx}-${r.id}`}
                      onClick={() => onReservationClick?.(r)}
                      className={`pointer-events-auto absolute text-left transition-all flex items-center overflow-hidden border-t text-[#1a1a18] dark:text-[#e8e7e3] text-[11px] font-medium bg-[var(--turnover-purple-bg)] border-[var(--turnover-purple-border)] ${
                        isSelected
                          ? 'ring-2 ring-[rgba(99,102,241,0.5)] dark:ring-[rgba(167,139,250,0.6)] shadow-lg z-10'
                          : ''
                      }`}
                      style={{
                        left: `calc(${leftPct + leftOffsetPct}%)`,
                        width: `calc(${spanPct - leftOffsetPct - rightOffsetPct}%)`,
                        top,
                        height: BAR_HEIGHT,
                        clipPath,
                        borderRadius,
                      }}
                      title={
                        (r.guest_name || 'Reservation') +
                        ' · ' +
                        format(toDateOnly(r.check_in), 'MMM d') +
                        ' → ' +
                        format(toDateOnly(r.check_out), 'MMM d')
                      }
                    >
                      {/* Only label the segment where the reservation
                          actually starts; continuation bars in later weeks
                          stay empty so the name doesn't repeat. Title
                          tooltip remains on every segment. */}
                      {!bar.startsBefore && (
                        <span
                          className="truncate"
                          style={{
                            paddingLeft: `${BAR_DIAGONAL_PX + 6}px`,
                            paddingRight: `${BAR_DIAGONAL_PX + 6}px`,
                          }}
                        >
                          {r.guest_name || 'No guest'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
