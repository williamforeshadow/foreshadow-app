'use client';

import { Button } from '@/components/ui/button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty, getTurnoverStatusColor } from '@/lib/turnoverUtils';
import type { Project } from '@/lib/types';

interface TimelineWindowProps {
  projects: Project[];
}

export default function TimelineWindow({ projects }: TimelineWindowProps) {
  const {
    properties,
    loading,
    selectedReservation,
    setSelectedReservation,
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
  } = useTimeline();

  const formatHeaderDate = (date: Date, isTodayDate: boolean) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return (
      <div className="text-center">
        <div className={`text-[11px] ${isTodayDate ? 'text-white/80' : 'text-neutral-600 dark:text-neutral-400'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-xs ${isTodayDate ? 'text-white font-semibold' : 'text-neutral-900 dark:text-white'}`}>
          {month}/{day}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with navigation - fixed at top */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Property Timeline
          </h2>

          <div className="flex items-center gap-4">
            {/* Navigation Controls */}
            <div className="flex items-center gap-2">
              <Button
                onClick={goToPrevious}
                variant="outline"
                size="sm"
              >
                ← Prev
              </Button>
              <Button
                onClick={goToToday}
                variant="outline"
                size="sm"
              >
                Today
              </Button>
              <Button
                onClick={goToNext}
                variant="outline"
                size="sm"
              >
                Next →
              </Button>
            </div>

            {/* View Toggle */}
            <div className="flex gap-2">
              <Button
                onClick={() => setView('week')}
                variant={view === 'week' ? 'default' : 'outline'}
                size="sm"
              >
                Week
              </Button>
              <Button
                onClick={() => setView('month')}
                variant={view === 'month' ? 'default' : 'outline'}
                size="sm"
              >
                Month
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable grid area */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        <div className="overflow-hidden">
          <div
            className="grid border border-neutral-200 dark:border-neutral-700 w-full"
            style={{
              gridTemplateColumns: `170px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-neutral-200 dark:bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-900 dark:text-white sticky left-0 top-0 z-20 border-b border-r border-neutral-300 dark:border-neutral-600">
              Property
            </div>
            {dateRange.map((date, idx) => {
              const isTodayDate = isToday(date);
              return (
                <div key={idx} className={`px-1 py-1 border-b border-r border-neutral-200 dark:border-neutral-700 sticky top-0 z-10 ${isTodayDate ? 'bg-emerald-700' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
                  {formatHeaderDate(date, isTodayDate)}
                </div>
              );
            })}

            {/* Property Rows */}
            {properties.map((property) => {
              const propertyReservations = getReservationsForProperty(property);
              const activeTurnover = getActiveTurnoverForProperty(propertyReservations);

              return (
                <div
                  key={property}
                  className="contents"
                >
                  {/* Property Name with Status Indicator */}
                  <div className="bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-900 dark:text-white sticky left-0 z-10 border-b border-r border-neutral-300 dark:border-neutral-600 flex items-center relative">
                    <span className="truncate pr-6">{property}</span>
                    {activeTurnover && (() => {
                      const propertyProjects = projects.filter(p => p.property_name === activeTurnover.property_name);
                      
                      return (
                        <HoverCard openDelay={100} closeDelay={200}>
                          <HoverCardTrigger asChild>
                            <div className="absolute right-0 top-0 bottom-0 w-10 flex items-center justify-center cursor-default">
                              <div 
                                className={`w-2.5 h-2.5 rounded-full ${getTurnoverStatusColor(activeTurnover.turnover_status)}`}
                              />
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent side="right" align="start" className="w-64 p-0">
                            {/* Header */}
                            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-700">
                              <p className="text-xs font-medium">{property}</p>
                            </div>
                            
                            {/* Tasks Section */}
                            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-700">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Tasks ({activeTurnover.tasks?.length || 0})
                              </p>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {activeTurnover.tasks && activeTurnover.tasks.length > 0 ? (
                                  activeTurnover.tasks.map((task) => (
                                    <div key={task.task_id} className="flex items-center justify-between gap-2 py-1">
                                      <span className="truncate text-xs">{task.template_name || task.type}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                        task.status === 'complete' 
                                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          : task.status === 'in_progress'
                                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                                      }`}>
                                        {task.status?.replace('_', ' ')}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground">No tasks</p>
                                )}
                              </div>
                            </div>
                            
                            {/* Projects Section */}
                            <div className="px-3 py-2">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Projects ({propertyProjects.length})
                              </p>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {propertyProjects.length > 0 ? (
                                  propertyProjects.map((project) => (
                                    <div key={project.id} className="flex items-center justify-between gap-2 py-1">
                                      <span className="truncate text-xs">{project.title}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                        project.status === 'complete' 
                                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          : project.status === 'in_progress'
                                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                                      }`}>
                                        {project.status?.replace('_', ' ')}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground">No projects</p>
                                )}
                              </div>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      );
                    })()}
                  </div>

                  {/* Date Cells with embedded reservations */}
                  {dateRange.map((date, idx) => {
                    const isTodayDate = isToday(date);
                    // Only render the block if this is the starting cell
                    const startingReservation = propertyReservations.find(res => {
                      const { start } = getBlockPosition(res.check_in, res.check_out);
                      return start === idx;
                    });

                    return (
                      <div
                        key={idx}
                        className={`border-b border-r border-neutral-200 dark:border-neutral-700 h-[38px] relative overflow-visible ${isTodayDate ? 'bg-emerald-700/20' : 'bg-white dark:bg-neutral-900'}`}
                      >
                        {startingReservation && (() => {
                          const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingReservation.check_in, startingReservation.check_out);

                          // Calculate actual position and width to create gaps between same-day turnovers
                          const leftOffset = startsBeforeRange ? 0 : 50;
                          const rightOffset = endsAfterRange ? 0 : 50;
                          const totalWidth = (span * 100) - leftOffset - rightOffset;

                          // Fixed pixel diagonal for consistent rhombus shape
                          const diagonalPx = 12;
                          const leftDiagonal = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                          const rightDiagonal = endsAfterRange ? '0px' : `${diagonalPx}px`;
                          const clipPath = `polygon(${leftDiagonal} 0%, 100% 0%, calc(100% - ${rightDiagonal}) 100%, 0% 100%)`;

                          return (
                            <div
                              onClick={() => {
                                setSelectedReservation(selectedReservation?.id === startingReservation.id ? null : startingReservation);
                              }}
                              className={`absolute cursor-pointer transition-all duration-150 hover:brightness-110 hover:z-30 text-white text-[11px] font-medium flex items-center bg-neutral-500 hover:bg-neutral-600 ${selectedReservation?.id === startingReservation.id ? 'ring-2 ring-white shadow-lg z-30' : ''}`}
                              style={{
                                left: `${leftOffset}%`,
                                top: 0,
                                bottom: 0,
                                width: `${totalWidth}%`,
                                zIndex: 15,
                                clipPath,
                              }}
                              title={`${startingReservation.guest_name || 'No guest'} - ${formatDate(new Date(startingReservation.check_in))} to ${formatDate(new Date(startingReservation.check_out))}`}
                            >
                              {!startsBeforeRange && (
                                <span className="truncate" style={{ paddingLeft: `${diagonalPx + 6}px`, paddingRight: `${diagonalPx + 6}px` }}>
                                  {startingReservation.guest_name || 'No guest'}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
