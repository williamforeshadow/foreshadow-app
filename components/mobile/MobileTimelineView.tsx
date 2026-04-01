'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty } from '@/lib/turnoverUtils';
import { Button } from '@/components/ui/button';
import DiamondIcon from '@/components/icons/AssignmentIcon';
import HexagonIcon from '@/components/icons/HammerIcon';
import { cn } from '@/lib/utils';
import type { Task, Project } from '@/lib/types';

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

const getTaskFolderStatus = (tasks: Task[]): string => {
  const active = tasks.filter(t => t.status !== 'contingent');
  if (active.length === 0) return 'no_tasks';
  const completed = active.filter(t => t.status === 'complete').length;
  if (completed === active.length) return 'complete';
  const inProgress = active.filter(t => t.status === 'in_progress' || t.status === 'paused').length;
  if (inProgress > 0 || completed > 0) return 'in_progress';
  return 'not_started';
};

const getProjectFolderStatus = (projects: Project[]): string => {
  if (projects.length === 0) return 'no_tasks';
  const completed = projects.filter(p => p.status === 'complete').length;
  if (completed === projects.length) return 'complete';
  const inProgress = projects.filter(p => p.status === 'in_progress' || p.status === 'on_hold').length;
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
  onProjectClick,
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

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [expandedCell, setExpandedCell] = useState<{ property: string; dateStr: string } | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      setLoadingProjects(true);
      try {
        const res = await fetch('/api/projects');
        const result = await res.json();
        setProjects(result?.data || []);
      } catch (err) {
        console.error('Error fetching projects:', err);
      } finally {
        setLoadingProjects(false);
      }
    };
    fetchProjects();
  }, [refreshTrigger]);

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

  const scheduledProjects = useMemo(() => {
    return projects.filter(p => p.scheduled_date);
  }, [projects]);

  const getCellItems = useCallback((propertyName: string, date: Date) => {
    const dateStr = toDateString(date);
    const tasks = allScheduledTasks.filter(
      t => t.property_name === propertyName && t.scheduled_date === dateStr
    );
    const projs = scheduledProjects.filter(
      p => p.property_name === propertyName && p.scheduled_date === dateStr
    );
    return { tasks, projects: projs };
  }, [allScheduledTasks, scheduledProjects]);

  const cellWidth = view === 'week' ? 56 : 30;
  const propertyCellWidth = 110;
  const rowHeight = 38;

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
      <div className="sticky top-0 z-40 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={goToPrevious}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-semibold" onClick={goToToday}>
              Today
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={goToNext}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>

          <div className="text-xs font-semibold text-neutral-900 dark:text-white">
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
              className="h-7 px-2 text-xs"
            >
              W
            </Button>
            <Button
              onClick={() => setView('month')}
              variant={view === 'month' ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
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
              className="sticky left-0 z-30 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm border-b border-r border-neutral-200 dark:border-neutral-700 px-2 py-1.5 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 flex items-center"
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
                    'border-b border-r border-neutral-200 dark:border-neutral-700 text-center py-1',
                    todayDate
                      ? 'bg-neutral-200/80 dark:bg-neutral-700/60'
                      : 'bg-white/95 dark:bg-neutral-900/95'
                  )}
                  style={{ width: cellWidth, minWidth: cellWidth }}
                >
                  <div className={cn(
                    'text-[9px] leading-tight',
                    todayDate ? 'text-neutral-800 dark:text-neutral-200 font-medium' : 'text-neutral-500 dark:text-neutral-400'
                  )}>
                    {date.toLocaleDateString('en-US', { weekday: view === 'week' ? 'short' : 'narrow' })}
                  </div>
                  <div className={cn(
                    'text-[11px] leading-tight',
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

            const activeTaskCount = activeTurnover?.tasks?.filter(t => t.status !== 'complete').length || 0;
            const propertyProjects = projects.filter(p => p.property_name === property);
            const activeProjectCount = propertyProjects.filter(p => p.status !== 'complete').length;

            return (
              <div key={property} className="flex">
                {/* Property name cell */}
                <div
                  className={cn(
                    'sticky left-0 z-10 border-b border-r border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-[11px] font-medium text-neutral-900 dark:text-white flex flex-col justify-center',
                    cellBg
                  )}
                  style={{ width: propertyCellWidth, minWidth: propertyCellWidth, height: rowHeight }}
                >
                  <span className="truncate leading-tight">{property}</span>
                  {(activeTaskCount > 0 || activeProjectCount > 0) && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {activeTaskCount > 0 && (
                        <div className="flex items-center gap-0.5 text-neutral-500 dark:text-neutral-400">
                          <DiamondIcon size={9} />
                          <span className="text-[9px]">{activeTaskCount}</span>
                        </div>
                      )}
                      {activeProjectCount > 0 && (
                        <div className="flex items-center gap-0.5 text-neutral-500 dark:text-neutral-400">
                          <HexagonIcon size={9} />
                          <span className="text-[9px]">{activeProjectCount}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Date cells */}
                {dateRange.map((date, idx) => {
                  const todayDate = isToday(date);
                  const startingRes = propReservations.find(res => {
                    const { start } = getBlockPosition(res.check_in, res.check_out);
                    return start === idx;
                  });

                  const { tasks: cellTasks, projects: cellProjects } = getCellItems(property, date);
                  const hasTasks = cellTasks.length > 0;
                  const hasProjects = cellProjects.length > 0;
                  const hasItems = hasTasks || hasProjects;

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
                          if (cellTasks.length + cellProjects.length === 1) {
                            if (cellTasks.length === 1) onTaskClick?.(cellTasks[0]);
                            else onProjectClick?.(cellProjects[0]);
                          } else {
                            const dateStr = toDateString(date);
                            setExpandedCell(prev =>
                              prev?.property === property && prev?.dateStr === dateStr ? null : { property, dateStr }
                            );
                          }
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

                        const diagonalPx = view === 'week' ? 8 : 4;
                        const leftDiag = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                        const rightDiag = endsAfterRange ? '0px' : `${diagonalPx}px`;
                        const clipPath = `polygon(${leftDiag} 0%, 100% 0%, calc(100% - ${rightDiag}) 100%, 0% 100%)`;

                        return (
                          <div
                            className="absolute pointer-events-none text-neutral-800 dark:text-white text-[9px] font-medium flex items-center glass-card glass-sheen overflow-hidden bg-neutral-400/35 dark:bg-white/[0.10] border border-white/40 dark:border-white/[0.12]"
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

                      {/* Task/Project icons */}
                      {hasItems && (
                        <div className="absolute bottom-0.5 left-0.5 flex items-center gap-px z-20">
                          {hasTasks && (
                            <div
                              className={cn(
                                'flex items-center justify-center rounded text-white border shadow-sm',
                                getIconStyles(getTaskFolderStatus(cellTasks)),
                                view === 'week' ? 'w-[18px] h-[18px]' : 'w-3.5 h-3.5'
                              )}
                            >
                              <DiamondIcon size={view === 'week' ? 10 : 8} />
                            </div>
                          )}
                          {hasProjects && (
                            <div
                              className={cn(
                                'flex items-center justify-center rounded text-white border shadow-sm',
                                getIconStyles(getProjectFolderStatus(cellProjects)),
                                view === 'week' ? 'w-[18px] h-[18px]' : 'w-3.5 h-3.5'
                              )}
                            >
                              <HexagonIcon size={view === 'week' ? 10 : 8} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom sheet for expanded cell items */}
      {expandedCell && (() => {
        const date = new Date(expandedCell.dateStr + 'T00:00:00');
        const { tasks: cellTasks, projects: cellProjects } = getCellItems(expandedCell.property, date);

        if (cellTasks.length === 0 && cellProjects.length === 0) return null;

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
              onClick={() => setExpandedCell(null)}
            />
            {/* Sheet */}
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700 rounded-t-2xl shadow-2xl max-h-[50vh] overflow-y-auto">
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
                {cellTasks.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <DiamondIcon size={10} /> Tasks ({cellTasks.length})
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
                          <span className="truncate text-sm font-medium">{task.template_name || task.type}</span>
                          <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {cellProjects.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <HexagonIcon size={10} /> Projects ({cellProjects.length})
                    </div>
                    <div className="space-y-1.5">
                      {cellProjects.map(project => (
                        <div
                          key={project.id}
                          className={cn(
                            'flex items-center justify-between gap-2 py-2.5 px-3 cursor-pointer transition-all duration-150 active:scale-[0.98]',
                            getRowStyles(project.status)
                          )}
                          onClick={() => {
                            onProjectClick?.(project);
                            setExpandedCell(null);
                          }}
                        >
                          <span className="truncate text-sm font-medium">{project.title}</span>
                          <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
