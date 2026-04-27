'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty } from '@/lib/turnoverUtils';
import { Button } from '@/components/ui/button';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/types';
import { DayDetailPanel } from '@/components/tasks/DayDetailPanel';
import type { TaskRowItem } from '@/components/tasks/TaskRow';

const marbleBackground: Record<string, string> = {
  not_started: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.35) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.18) 10%, transparent 40%, rgba(255,255,255,0.12) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #A78BFA`,
  in_progress: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.18) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #6366F1`,
  paused: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #8B7FA8`,
  complete: `radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.12) 10%, transparent 40%, rgba(255,255,255,0.08) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #4C4869`,
};

const getFolderStatus = (items: Task[]): string => {
  const active = items.filter(t => t.status !== 'contingent');
  if (active.length === 0) return 'no_tasks';
  const completed = active.filter(t => t.status === 'complete').length;
  if (completed === active.length) return 'complete';
  const inProgress = active.filter(t => t.status === 'in_progress').length;
  if (inProgress > 0) return 'in_progress';
  const paused = active.filter(t => t.status === 'paused').length;
  if (paused > 0 || completed > 0) return 'paused';
  return 'not_started';
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
}

export default function MobileTimelineView({
  onCardClick,
  onTaskClick,
  refreshTrigger,
  onSheetOpen,
  onNewTask,
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

  const [expandedCell, setExpandedCell] = useState<{ property: string; dateStr: string } | null>(null);

  useEffect(() => {
    onSheetOpen?.(expandedCell !== null);
  }, [expandedCell, onSheetOpen]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchReservations();
    }
  }, [refreshTrigger, fetchReservations]);

  const allTasksWithProperty = useMemo(() => {
    const tasks: (Task & { property_name: string })[] = [];
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        tasks.push({ ...task, property_name: res.property_name });
      });
    });
    recurringTasks.forEach((task: any) => {
      tasks.push({ ...task, property_name: task.property_name });
    });
    return tasks;
  }, [reservations, recurringTasks]);

  const allScheduledTasks = useMemo(() => {
    return allTasksWithProperty.filter(task => task.scheduled_date);
  }, [allTasksWithProperty]);

  const getCellTasks = useCallback((propertyName: string, date: Date) => {
    const dateStr = toDateString(date);
    return allScheduledTasks.filter(
      t => t.property_name === propertyName && t.scheduled_date === dateStr
    );
  }, [allScheduledTasks]);

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
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 pl-14 pr-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={goToPrevious}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <Button variant="ghost" size="sm" className="h-9 px-3 text-sm font-semibold" onClick={goToToday}>
              Today
            </Button>
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={goToNext}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>

          <div className="text-sm font-semibold text-neutral-900 dark:text-white">
            {dateRange.length > 0 && (
              <>
                {formatDate(dateRange[0])} – {formatDate(dateRange[dateRange.length - 1])}
              </>
            )}
          </div>

          <div className="flex gap-1">
            <Button
              onClick={() => setView('week')}
              variant={view === 'week' ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-2.5 text-sm"
            >
              W
            </Button>
            <Button
              onClick={() => setView('month')}
              variant={view === 'month' ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-2.5 text-sm"
            >
              M
            </Button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto hide-scrollbar">
        <div className="min-w-max overflow-x-clip">
          {/* Date header row */}
          <div className="flex sticky top-0 z-30">
            <div
              className="sticky left-0 z-30 bg-white dark:bg-[#0d0d10] border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.06)] px-1.5 py-2 text-xs font-semibold text-[#6b6963] dark:text-[#9a9893] flex items-center"
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
                      : 'bg-white dark:bg-[#0d0d10]'
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
          {properties.map((property) => {
            const propReservations = getReservationsForProperty(property);
            const activeTurnover = getActiveTurnoverForProperty(propReservations);

            return (
              <div key={property}>
              <div className="flex">
                <div
                  className="sticky left-0 z-30 bg-white dark:bg-[#0d0d10] border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.06)]"
                  style={{ width: propertyCellWidth, minWidth: propertyCellWidth, height: rowHeight }}
                >
                  <div
                    className="relative overflow-hidden w-full h-full px-1.5 text-xs font-medium text-[#1a1a18] dark:text-[#e8e7e3] flex items-center"
                  >
                    <span className="truncate">{property}</span>
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
                        todayDate ? 'today-tint' : 'bg-white dark:bg-[#0d0d10]'
                      )}
                      style={{ width: cellWidth, minWidth: cellWidth, height: rowHeight }}
                      onClick={() => {
                        // Every cell — empty or not — opens the day-drawer
                        // for this property + date. The drawer's empty
                        // state surfaces the "New task" CTA, mirroring
                        // the property-calendar behavior on empty days.
                        const dateStr = toDateString(date);
                        setExpandedCell(prev =>
                          prev?.property === property && prev?.dateStr === dateStr ? null : { property, dateStr }
                        );
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

                        // Top-only stroke (border-t-2) matches the desktop
                        // Timeline + property Schedule grid so reservation
                        // bars read identically across web/mobile/schedule.
                        const turnoverStatus = activeTurnover?.turnover_status || 'not_started';
                        let bgClass: string;
                        switch (turnoverStatus) {
                          case 'complete':
                            bgClass = 'bg-[rgba(76,72,105,0.18)] dark:bg-[rgba(76,72,105,0.25)] border-[rgba(76,72,105,0.38)] dark:border-[rgba(76,72,105,0.45)]';
                            break;
                          case 'in_progress':
                            bgClass = 'bg-[rgba(99,102,241,0.16)] dark:bg-[rgba(99,102,241,0.22)] border-[rgba(99,102,241,0.38)] dark:border-[rgba(99,102,241,0.45)]';
                            break;
                          default:
                            bgClass = 'bg-[rgba(167,139,250,0.16)] dark:bg-[rgba(167,139,250,0.18)] border-[rgba(167,139,250,0.38)] dark:border-[rgba(167,139,250,0.45)]';
                            break;
                        }

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
                            {!startsBeforeRange && view === 'week' && (
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

                      {hasItems && (() => {
                        const folderStatus = getFolderStatus(cellTasks);
                        const hasActive = folderStatus !== 'no_tasks';
                        return (
                          <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 z-[5]">
                            <div
                              className={cn(
                                'flex items-center justify-center rounded shadow-sm hover:brightness-110 transition-all',
                                hasActive ? 'text-white' : 'text-[#1a1a18] dark:text-white bg-white dark:bg-[#1a1a1d] border border-[rgba(30,25,20,0.12)] dark:border-[rgba(255,255,255,0.12)]',
                                view === 'week' ? 'w-[22px] h-[22px]' : 'w-4 h-4'
                              )}
                              style={hasActive ? { background: marbleBackground[folderStatus] || marbleBackground.not_started } : undefined}
                            >
                              <ClipboardCheck className={view === 'week' ? 'w-3 h-3' : 'w-2.5 h-2.5'} />
                            </div>
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

        const dayTasks: TaskRowItem[] = cellTasks.map((t) => ({
          key: t.task_id,
          title: t.title || t.template_name || t.type || 'Task',
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
            <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#0b0b0c] border-t border-[rgba(30,25,20,0.08)] dark:border-white/10 rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col safe-area-bottom">
              <DayDetailPanel
                date={date}
                title={expandedCell.property}
                onClose={() => setExpandedCell(null)}
                tasks={dayTasks}
                onTaskClick={handleTaskClickFromDrawer}
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
