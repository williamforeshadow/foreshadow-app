'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { applyCleaningFilters, type CleaningFilters } from '@/lib/cleaningFilters';
import { LogIn, LogOut } from 'lucide-react';
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

  // Card styling — three states only:
  //   - Past: muted grey, slightly faded
  //   - Upcoming (not first-in-row OR check-in hasn't happened yet): grey
  //     with dashed ("checkered") border indicating a future stay
  //   - Active: shared purple — same color tokens as Timeline reservation
  //     bars + the day-cell drawer rows so the whole app reads as one
  //     system. Status (not_started / in_progress / complete) no longer
  //     affects color — progress is communicated by the progress bar +
  //     "N/N tasks complete" line.
  const getCardStyles = (
    isFirstInRow: boolean,
    checkInDate: string | undefined | null,
    isPast?: boolean
  ) => {
    const glassBase = 'glass-card glass-sheen';

    if (isPast) {
      return `${glassBase} bg-neutral-100 dark:bg-white/[0.07] border border-neutral-200 dark:border-white/10 opacity-75`;
    }

    const now = new Date();
    const checkIn = checkInDate ? new Date(checkInDate) : null;
    const hasCheckedIn = checkIn && now >= checkIn;

    if (!isFirstInRow || !hasCheckedIn) {
      return `${glassBase} bg-neutral-100 dark:bg-white/[0.08] border border-dashed border-neutral-400 dark:border-white/30`;
    }

    return `${glassBase} bg-[rgba(167,139,250,0.16)] dark:bg-[rgba(167,139,250,0.18)] border border-[rgba(167,139,250,0.38)] dark:border-[rgba(167,139,250,0.45)]`;
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
        className={`group cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 ease-out !flex !flex-col !p-4 gap-4 flex-shrink-0 ${cardWidth} ${getCardStyles(isFirstInRow, item.check_in, isPast)} relative overflow-hidden rounded-2xl`}
      >
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
            className="absolute top-1.5 right-1.5 z-10 p-0.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 hover:bg-white/40 dark:hover:bg-white/10 backdrop-blur-sm transition-colors"
            title="Hide"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* 1) Guest name + occupancy badge inline */}
        <div className="flex items-center gap-2">
          <p className="line-clamp-1 text-sm font-medium flex-1 min-w-0">
            {item.guest_name || 'No Guest'}
          </p>
          {isInPlay && (
            <Badge 
              className={`px-2 py-0.5 text-[11px] backdrop-blur-sm shrink-0 ${
                item.occupancy_status === 'occupied' 
                  ? 'bg-white/35 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 border-neutral-300/30 dark:border-white/10'
                  : 'bg-white/30 dark:bg-white/10 text-neutral-600 dark:text-neutral-400 border-neutral-300/30 dark:border-white/10'
              }`}
            >
              {item.occupancy_status === 'occupied' ? 'Occupied' : 'Checked out'}
            </Badge>
          )}
        </div>

        {/* 3) N/N tasks complete */}
        {(() => {
          const approvedTasks = (item.tasks || []).filter(t => t.status !== 'contingent');
          const total = approvedTasks.length;
          const done = approvedTasks.filter(t => t.status === 'complete').length;
          if (total === 0) return null;
          return (
            <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
              {done}/{total} tasks complete
            </p>
          );
        })()}

        {/* Spacer to push footer content to bottom */}
        <div className="flex-grow" />

        {/* 4) Progress bar */}
        {(() => {
          const approvedTasks = (item.tasks || []).filter(t => t.status !== 'contingent');
          const total = approvedTasks.length;
          const done = approvedTasks.filter(t => t.status === 'complete').length;
          const pct = total > 0 ? (done / total) * 100 : 0;
          return (
            <div className="w-full">
              <div className="h-1 w-full rounded-full bg-neutral-200/40 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-400/60 dark:bg-indigo-400/40 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

        {/* 5) Check-in (this reservation) → Check-out (this reservation) */}
        <div className="flex w-full justify-between text-xs text-muted-foreground/60">
          <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-white/20 dark:border-white/15 bg-white/25 dark:bg-white/[0.08] backdrop-blur-sm px-2 py-1 ${!item.check_in ? 'opacity-40' : ''}`}>
            <LogIn className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-400" />
            <span>{formatDate(item.check_in) || 'In'}</span>
          </div>
          <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-white/20 dark:border-white/15 bg-white/25 dark:bg-white/[0.08] backdrop-blur-sm px-2 py-1 ${!item.check_out ? 'opacity-40' : ''}`}>
            <LogOut className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-400" />
            <span>{formatDate(item.check_out) || 'Out'}</span>
          </div>
        </div>
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
              <div className="flex-1 h-px bg-neutral-300/30 dark:bg-white/10" />
              <span className="text-xs text-neutral-500/70 dark:text-neutral-400/60 shrink-0">
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
                    className={`flex-shrink-0 flex items-center justify-center w-8 rounded-xl transition-all ${
                      hasMorePast
                        ? 'hover:bg-white/40 dark:hover:bg-white/10 hover:backdrop-blur-sm cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                        : 'text-neutral-300/50 dark:text-neutral-700/50 cursor-default'
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
