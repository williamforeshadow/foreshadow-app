'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty } from '@/lib/turnoverUtils';
import { Button } from '@/components/ui/button';
import { ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import type { Task } from '@/lib/types';

const getRowStyles = (status: string) => {
  const base = 'glass-card glass-sheen relative overflow-hidden rounded-lg';
  switch (status) {
    case 'complete':
      return `${base} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`;
    case 'in_progress':
    case 'paused':
      return `${base} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'contingent':
      return `${base} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`;
    case 'on_hold':
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
    default:
      return `${base} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
  }
};

const getFolderStatus = (items: (Task | Project)[]): string => {
  const active = items.filter(t => t.status !== 'contingent');
  if (active.length === 0) return 'no_tasks';
  const completed = active.filter(t => t.status === 'complete').length;
  if (completed === active.length) return 'complete';
  const inProgress = active.filter(t => t.status === 'in_progress' || t.status === 'paused' || t.status === 'on_hold').length;
  if (inProgress > 0 || completed > 0) return 'in_progress';
  return 'not_started';
};

const getIconStyles = (status: string) => {
  switch (status) {
    case 'complete': return 'bg-emerald-100 dark:bg-emerald-900 border-emerald-200/40 dark:border-emerald-400/20';
    case 'in_progress': return 'bg-indigo-100 dark:bg-indigo-900 border-indigo-300/40 dark:border-indigo-400/20';
    case 'not_started': return 'bg-amber-100 dark:bg-amber-900 border-amber-200/40 dark:border-amber-400/20';
    default: return 'bg-neutral-100 dark:bg-neutral-800 border-neutral-300/35 dark:border-white/12';
  }
};

const toDateString = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface MobileTimelineViewProps {
  onCardClick?: (card: any) => void;
  onTaskClick?: (task: any) => void;
  onProjectClick?: (project: any) => void;
  refreshTrigger?: number;
}

export default function MobileTimelineView({
  onCardClick,
  onTaskClick,
  refreshTrigger,
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

  const { deptIconMap } = useDepartments();
  const [expandedCell, setExpandedCell] = useState<{ property: string; dateStr: string } | null>(null);
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());

  const togglePropertyExpanded = useCallback((property: string) => {
    setExpandedProperties(prev => {
      const next = new Set(prev);
      if (next.has(property)) next.delete(property);
      else next.add(property);
      return next;
    });
  }, []);

  const toggleAllExpanded = useCallback(() => {
    setExpandedProperties(prev => {
      if (prev.size === properties.length) return new Set();
      return new Set(properties);
    });
  }, [properties]);

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
        <div className="min-w-max">
          {/* Date header row */}
          <div className="flex sticky top-0 z-30">
            <div
              className="sticky left-0 z-30 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm border-b border-r border-neutral-200 dark:border-neutral-700 px-1.5 py-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300 flex items-center gap-1"
              style={{ width: propertyCellWidth, minWidth: propertyCellWidth }}
              onClick={toggleAllExpanded}
            >
              <svg
                className={cn('w-3 h-3 shrink-0 transition-transform duration-200', expandedProperties.size === properties.length && 'rotate-90')}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Property
            </div>
            {dateRange.map((date, idx) => {
              const todayDate = isToday(date);
              return (
                <div
                  key={idx}
                  className={cn(
                    'border-b border-r border-neutral-200 dark:border-neutral-700 text-center py-1.5',
                    todayDate
                      ? 'bg-neutral-200/80 dark:bg-neutral-700/60'
                      : 'bg-white/95 dark:bg-neutral-900/95'
                  )}
                  style={{ width: cellWidth, minWidth: cellWidth }}
                >
                  <div className={cn(
                    'text-[10px] leading-tight',
                    todayDate ? 'text-neutral-800 dark:text-neutral-200 font-medium' : 'text-neutral-500 dark:text-neutral-400'
                  )}>
                    {date.toLocaleDateString('en-US', { weekday: view === 'week' ? 'short' : 'narrow' })}
                  </div>
                  <div className={cn(
                    'text-xs leading-tight',
                    todayDate ? 'font-bold text-neutral-900 dark:text-white' : 'text-neutral-800 dark:text-neutral-200'
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

            const cellBg = activeTurnover
              ? (() => {
                  switch (activeTurnover.turnover_status) {
                    case 'not_started': return 'bg-amber-50/55 dark:bg-amber-400/[0.12]';
                    case 'in_progress': return 'bg-indigo-50/55 dark:bg-indigo-500/[0.12]';
                    case 'complete': return 'bg-emerald-50/55 dark:bg-emerald-500/[0.12]';
                    case 'no_tasks': return 'bg-white/55 dark:bg-white/[0.09]';
                    default: return 'bg-white/45 dark:bg-white/[0.07]';
                  }
                })()
              : 'bg-white/45 dark:bg-white/[0.07]';

            const isExpanded = expandedProperties.has(property);

            return (
              <div key={property}>
              <div className="flex">
                {/* Property name cell — opaque base + glass overlay */}
                <div
                  className="sticky left-0 z-30 bg-white dark:bg-neutral-900 border-b border-r border-neutral-200 dark:border-neutral-700"
                  style={{ width: propertyCellWidth, minWidth: propertyCellWidth, height: rowHeight }}
                  onClick={() => togglePropertyExpanded(property)}
                >
                  <div
                    className={cn(
                      'glass-card glass-sheen relative overflow-hidden w-full h-full px-1.5 text-xs font-medium text-neutral-900 dark:text-white flex items-center gap-1',
                      cellBg
                    )}
                  >
                    <svg
                      className={cn('w-3 h-3 shrink-0 text-neutral-400 transition-transform duration-200', isExpanded && 'rotate-90')}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
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
                        'border-b border-r border-neutral-200/50 dark:border-neutral-700/50 relative overflow-visible',
                        todayDate ? 'bg-neutral-200/25 dark:bg-white/[0.04]' : 'bg-white/25 dark:bg-white/[0.02]'
                      )}
                      style={{ width: cellWidth, minWidth: cellWidth, height: rowHeight }}
                      onClick={() => {
                        if (hasItems) {
                          const dateStr = toDateString(date);
                          setExpandedCell(prev =>
                            prev?.property === property && prev?.dateStr === dateStr ? null : { property, dateStr }
                          );
                          return;
                        }
                        const res = propReservations.find(r => {
                          const pos = getBlockPosition(r.check_in, r.check_out);
                          return idx >= pos.start && idx < pos.start + pos.span;
                        });
                        if (res) onCardClick?.(res);
                      }}
                    >
                      {/* Reservation block */}
                      {startingRes && (() => {
                        const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingRes.check_in, startingRes.check_out);
                        const leftOffset = startsBeforeRange ? 0 : 50;
                        const rightOffset = endsAfterRange ? 0 : 50;
                        const totalWidth = (span * 100) - leftOffset - rightOffset;

                        const diagonalPx = view === 'week' ? 10 : 5;
                        const leftDiag = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                        const rightDiag = endsAfterRange ? '0px' : `${diagonalPx}px`;
                        const clipPath = `polygon(${leftDiag} 0%, 100% 0%, calc(100% - ${rightDiag}) 100%, 0% 100%)`;

                        return (
                          <div
                            className="absolute pointer-events-none text-neutral-800 dark:text-white text-[11px] font-medium flex items-center glass-card glass-sheen overflow-hidden bg-neutral-400/35 dark:bg-white/[0.10] border border-white/40 dark:border-white/[0.12]"
                            style={{
                              left: `${leftOffset}%`,
                              top: 0,
                              bottom: 0,
                              width: `${totalWidth}%`,
                              zIndex: 15,
                              clipPath,
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

                      {/* Task icon */}
                      {hasItems && (
                        <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 z-20">
                          <div
                            className={cn(
                              'flex items-center justify-center rounded text-white border shadow-sm',
                              getIconStyles(getFolderStatus(cellTasks)),
                              view === 'week' ? 'w-[22px] h-[22px]' : 'w-4 h-4'
                            )}
                          >
                            <ClipboardCheck className={view === 'week' ? 'w-3 h-3' : 'w-2.5 h-2.5'} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Expanded detail row */}
              {isExpanded && (
                <div className="flex">
                  {/* Empty property column for expanded row */}
                  <div
                    className={cn(
                      'sticky left-0 z-30 bg-white dark:bg-neutral-900 border-b border-r border-neutral-200 dark:border-neutral-700'
                    )}
                    style={{ width: propertyCellWidth, minWidth: propertyCellWidth }}
                  >
                    <div className={cn('w-full h-full', cellBg)} />
                  </div>

                  {/* Date cells with task/project cards */}
                  {dateRange.map((date, idx) => {
                    const todayDate = isToday(date);
                    const cellDateStr = toDateString(date);
                    const dateTasks = allScheduledTasks.filter(
                      t => t.property_name === property && t.scheduled_date === cellDateStr
                    );
                    const hasItems = dateTasks.length > 0;

                    return (
                      <div
                        key={`expanded-${idx}`}
                        className={cn(
                          'border-b border-r border-neutral-200/50 dark:border-neutral-700/50 p-1',
                          todayDate ? 'bg-neutral-200/20 dark:bg-white/[0.03]' : 'bg-white/15 dark:bg-white/[0.015]'
                        )}
                        style={{ width: cellWidth, minWidth: cellWidth }}
                      >
                        {hasItems && (
                          <div className="flex flex-col gap-1">
                            {dateTasks.map(task => {
                              const TaskDeptIcon = getDepartmentIcon(task.department_id ? deptIconMap[task.department_id] : null);
                              const firstUser = task.assigned_users?.[0];
                              const extraCount = (task.assigned_users?.length ?? 0) - 1;
                              return (
                                <div
                                  key={task.task_id}
                                  className={cn(
                                    'flex items-center gap-1.5 py-1.5 px-1.5 cursor-pointer transition-all duration-150 active:scale-[0.97]',
                                    getRowStyles(task.status)
                                  )}
                                  onClick={() => setExpandedCell({ property, dateStr: cellDateStr })}
                                >
                                  <TaskDeptIcon size={14} className="shrink-0 text-neutral-600 dark:text-neutral-300" />
                                  {firstUser && (
                                    <div className="relative shrink-0">
                                      <UserAvatar src={firstUser.avatar} name={firstUser.name || 'Unknown'} size="xs" />
                                      {extraCount > 0 && (
                                        <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[13px] h-[13px] px-0.5 rounded-full bg-neutral-700 dark:bg-neutral-200 text-[8px] font-medium text-white dark:text-neutral-800 border border-white dark:border-neutral-900">
                                          +{extraCount}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
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
            );
          })}
        </div>
      </div>

      {/* Bottom sheet for expanded cell items */}
      {expandedCell && (() => {
        const date = new Date(expandedCell.dateStr + 'T00:00:00');
        const cellTasks = getCellTasks(expandedCell.property, date);

        if (cellTasks.length === 0) return null;

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
              onClick={() => setExpandedCell(null)}
            />
            {/* Sheet */}
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700 rounded-t-2xl shadow-2xl max-h-[50vh] overflow-y-auto safe-area-bottom">
              {/* Drag handle */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600" />
              </div>

              {/* Header */}
              <div className="px-4 pb-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-white">{expandedCell.property}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <button
                  onClick={() => setExpandedCell(null)}
                  className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Items */}
              <div className="px-4 pb-6 space-y-3">
                <div>
                  <div className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <ClipboardCheck className="w-2.5 h-2.5" /> Tasks ({cellTasks.length})
                  </div>
                  <div className="space-y-1.5">
                    {cellTasks.map(task => (
                      <div
                        key={task.task_id}
                        className={cn(
                          'flex items-center justify-between gap-2 py-2.5 px-3 cursor-pointer transition-all duration-150 active:scale-[0.98]',
                          getRowStyles(task.status)
                        )}
                        onClick={() => {
                          onTaskClick?.(task);
                          setExpandedCell(null);
                        }}
                      >
                        <span className="truncate text-sm font-medium">{task.title || task.template_name || task.type}</span>
                        <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
