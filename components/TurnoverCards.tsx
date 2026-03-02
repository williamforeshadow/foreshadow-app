'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { applyCleaningFilters, type CleaningFilters } from '@/lib/cleaningFilters';
import FlagCheckeredIcon from '@/components/ui/FlagCheckeredIcon';
import type { Turnover } from '@/lib/types';

interface TurnoverCardsProps {
  data: Turnover[] | null;
  filters: CleaningFilters;
  sortBy: string;
  onCardClick: (card: Turnover) => void;
  compact?: boolean;
}

export default function TurnoverCards({ data, filters, sortBy, onCardClick, compact = false }: TurnoverCardsProps) {
  // Track how many past turnovers to show per property
  const [pastCount, setPastCount] = useState<Record<string, number>>({});

  const loadOnePast = (propertyName: string) => {
    setPastCount(prev => ({
      ...prev,
      [propertyName]: (prev[propertyName] || 0) + 1,
    }));
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No turnovers found
      </div>
    );
  }

  // Apply filters
  let items = applyCleaningFilters(data, filters);
  
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No cards match the selected filters
      </div>
    );
  }

  // Separate into active and past turnovers
  const now = new Date();
  
  const activeItems: Turnover[] = [];
  const pastItems: Turnover[] = [];

  items.forEach(item => {
    const checkOut = item.check_out ? new Date(item.check_out) : null;
    const nextCheckIn = item.next_check_in ? new Date(item.next_check_in) : null;
    
    const isActive =
      (checkOut && checkOut >= now) ||
      (!nextCheckIn || nextCheckIn >= now);

    if (isActive) {
      activeItems.push(item);
    } else {
      pastItems.push(item);
    }
  });

  items = activeItems;

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No active turnovers found
      </div>
    );
  }

  // Group active items by property name
  const groupedByProperty = items.reduce((acc, item) => {
    const propertyName = item.property_name || 'Unknown Property';
    if (!acc[propertyName]) {
      acc[propertyName] = [];
    }
    acc[propertyName].push(item);
    return acc;
  }, {} as Record<string, Turnover[]>);

  // Group past items by property, sorted most-recent first (by check_out descending)
  const pastByProperty = pastItems.reduce((acc, item) => {
    const propertyName = item.property_name || 'Unknown Property';
    if (!acc[propertyName]) {
      acc[propertyName] = [];
    }
    acc[propertyName].push(item);
    return acc;
  }, {} as Record<string, Turnover[]>);

  Object.keys(pastByProperty).forEach(prop => {
    pastByProperty[prop].sort((a, b) => {
      const dateA = a.check_out ? new Date(a.check_out).getTime() : 0;
      const dateB = b.check_out ? new Date(b.check_out).getTime() : 0;
      return dateB - dateA; // most recent past first
    });
  });

  // Sort properties alphabetically and sort cards within each property chronologically
  const sortedProperties = Object.keys(groupedByProperty).sort((a, b) => 
    a.localeCompare(b)
  );

  // Sort cards within each property by check_out date (chronological)
  // and mark each card as active or upcoming
  sortedProperties.forEach(property => {
    groupedByProperty[property].sort((a: Turnover, b: Turnover) => {
      const dateA = a.check_out ? new Date(a.check_out).getTime() : 0;
      const dateB = b.check_out ? new Date(b.check_out).getTime() : 0;
      return dateA - dateB;
    });
    
    // Mark each card's timeline status (active = first card with check-in passed)
    groupedByProperty[property].forEach((item: Turnover, index: number) => {
      const checkIn = item.check_in ? new Date(item.check_in) : null;
      item._isActive = index === 0 && checkIn && now >= checkIn;
    });
  });

  // Apply timeline filter if set - filter within each property group
  if (filters.timeline.length > 0) {
    sortedProperties.forEach(property => {
      groupedByProperty[property] = groupedByProperty[property].filter((item: Turnover) => {
        if (filters.timeline.includes('active') && !filters.timeline.includes('upcoming')) {
          return item._isActive;
        }
        if (filters.timeline.includes('upcoming') && !filters.timeline.includes('active')) {
          return !item._isActive;
        }
        return true;
      });
    });
  }

  // Filter out properties with no cards after timeline filter
  const filteredProperties = sortedProperties.filter(
    property => groupedByProperty[property].length > 0
  );

  if (filteredProperties.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No turnovers match the selected filters
      </div>
    );
  }

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };

  // Get card styling based on status, position, occupancy, and whether guest has checked in
  const getCardStyles = (status: string, isFirstInRow: boolean, checkInDate: string | undefined | null, occupancyStatus: string | undefined, isPast?: boolean) => {
    // Past turnovers — muted grey, solid border
    if (isPast) {
      return 'bg-neutral-50/80 dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-700 opacity-75';
    }

    const now = new Date();
    
    const checkIn = checkInDate ? new Date(checkInDate) : null;
    const hasCheckedIn = checkIn && now >= checkIn;
    
    // Inactive (upcoming) — grey dotted
    if (!isFirstInRow || !hasCheckedIn) {
      return 'bg-neutral-50 dark:bg-neutral-900 border border-dashed border-neutral-300 dark:border-neutral-600';
    }
    
    // Active + Occupied — blue (guest still in property)
    if (occupancyStatus === 'occupied') {
      return 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900';
    }
    
    // Active + Out — status-dependent (red/yellow/green)
    switch (status) {
      case 'not_started':
        return 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900';
      case 'in_progress':
        return 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900';
      case 'complete':
        return 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900';
      case 'no_tasks':
        return 'bg-neutral-50/80 dark:bg-neutral-800/30 border-neutral-200 dark:border-neutral-700';
      default:
        return 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700';
    }
  };

  // Card width - slightly narrower in compact mode
  const cardWidth = compact ? 'w-[240px]' : 'w-[280px]';

  // Render a single turnover card
  const renderCard = (item: Turnover, isFirstInRow: boolean, isPast: boolean) => {
    const checkIn = item.check_in ? new Date(item.check_in) : null;
    const isInPlay = isFirstInRow && checkIn && now >= checkIn && !isPast;

    return (
      <Card
        key={item.id}
        onClick={() => onCardClick(item)}
        className={`group cursor-pointer hover:shadow-xl transition-all duration-200 !flex !flex-col !p-4 gap-4 flex-shrink-0 ${cardWidth} ${getCardStyles(item.turnover_status || 'no_tasks', isFirstInRow, item.check_in, item.occupancy_status, isPast)} relative overflow-hidden`}
      >
        {/* Turnover Stamp */}
        <img 
          src="/Turnover.png" 
          alt="" 
          className="absolute right-2 top-1/2 -translate-y-1/2 w-20 h-20 rotate-[-12deg] pointer-events-none select-none"
        />

        {/* Dismiss button for past cards */}
        {isPast && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPastCount(prev => ({
                ...prev,
                [item.property_name]: Math.max((prev[item.property_name] || 1) - 1, 0),
              }));
            }}
            className="absolute top-1.5 right-1.5 z-10 p-0.5 rounded-md text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 transition-colors"
            title="Hide"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        
        <CardHeader className="min-h-[3rem]">
          <CardDescription className="line-clamp-1 text-sm font-medium">
            {item.guest_name || 'No Guest'}
          </CardDescription>
          <CardAction>
            {(() => {
              const approvedTasks = (item.tasks || []).filter(t => t.status !== 'contingent');
              const total = approvedTasks.length;
              const done = approvedTasks.filter(t => t.status === 'complete').length;
              const inProg = approvedTasks.some(t => t.status === 'in_progress' || t.status === 'complete');
              if (total === 0) return null;
              return (
                <Badge 
                  className={`font-semibold px-2.5 py-1 ${
                    done === total
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                      : inProg
                      ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                  }`}
                >
                  {done}/{total}
                </Badge>
              );
            })()}
          </CardAction>
        </CardHeader>

        <CardContent className="flex-grow">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Occupancy badge - only show on "in play" cards */}
            {isInPlay && (
              <Badge 
                className={`px-2.5 py-1 ${
                  item.occupancy_status === 'occupied' 
                    ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                    : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                }`}
              >
                {item.occupancy_status === 'occupied' ? 'Occupied' : 'Out'}
              </Badge>
            )}
          </div>
        </CardContent>

        <CardFooter className="mt-auto flex flex-col gap-2">
          <div className="w-full py-1">
            <div className="h-px w-full bg-border/60" />
          </div>
          <div className="flex w-full justify-between text-xs text-muted-foreground/60">
            <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 transition-all duration-150 hover:border-border hover:bg-[var(--mix-card-50-bg)] ${!item.check_out ? 'opacity-40' : ''}`}>
              <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>{formatDate(item.check_out) || 'Out'}</span>
            </div>
            <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 transition-all duration-150 hover:border-border hover:bg-[var(--mix-card-50-bg)] ${!item.next_check_in ? 'opacity-40' : ''}`}>
              <FlagCheckeredIcon className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-400" />
              <span>{formatDate(item.next_check_in) || 'In'}</span>
            </div>
          </div>
        </CardFooter>
      </Card>
    );
  };

  return (
    <div>
      {filteredProperties.map((propertyName) => {
        const pastPool = pastByProperty[propertyName] || [];
        const shownPastCount = pastCount[propertyName] || 0;
        // Take N most-recent past turnovers, then reverse for chronological display order
        const pastToShow = pastPool.slice(0, shownPastCount).reverse();
        const hasMorePast = pastPool.length > shownPastCount;

        return (
          <div key={propertyName}>
            {/* Property Header with inline separator */}
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 shrink-0">
                {propertyName}
              </h3>
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground shrink-0">
                {groupedByProperty[propertyName].length} turnover{groupedByProperty[propertyName].length !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* Horizontal Scrollable Row with ScrollArea */}
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-4 py-4 items-stretch">
                {/* Load Past Button / Alignment Spacer */}
                {pastPool.length > 0 ? (
                  <button
                    onClick={() => loadOnePast(propertyName)}
                    disabled={!hasMorePast}
                    className={`flex-shrink-0 flex items-center justify-center w-8 rounded-lg transition-all ${
                      hasMorePast
                        ? 'hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                        : 'text-neutral-200 dark:text-neutral-700 cursor-default'
                    }`}
                    title={hasMorePast ? `Load previous turnover (${pastPool.length - shownPastCount} more)` : 'No more past turnovers'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                ) : (
                  <div className="flex-shrink-0 w-8" />
                )}

                {/* Past Turnover Cards */}
                {pastToShow.map((item) => renderCard(item, false, true))}

                {/* Active + Upcoming Turnover Cards */}
                {groupedByProperty[propertyName].map((item: Turnover, index: number) =>
                  renderCard(item, index === 0, false)
                )}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
}
