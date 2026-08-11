'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { applyCleaningFilters, type CleaningFilters } from '@/lib/cleaningFilters';
import { BedDouble, CircleCheck, Loader, LogIn, LogOut } from 'lucide-react';
import { getPropertyReadiness, type PropertyReadiness } from '@/lib/propertyReadiness';
import type { Turnover } from '@/lib/types';

interface TurnoverCardsProps {
  data: Turnover[] | null;
  filters: CleaningFilters;
  onCardClick: (card: Turnover) => void;
}

export default function TurnoverCards({ data, filters, onCardClick }: TurnoverCardsProps) {
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
        No reservations found
      </div>
    );
  }

  // Property readiness, computed from the property's FULL reservation list
  // (unfiltered — same input the Timeline's property column feeds
  // getPropertyReadiness), so the icon here always matches the Timeline's
  // regardless of what filters are active on this page.
  const readinessByProperty = new Map<string, PropertyReadiness | null>();
  {
    const allByProperty = new Map<string, Turnover[]>();
    for (const item of data) {
      const key = item.property_name || 'Unknown Property';
      const list = allByProperty.get(key);
      if (list) list.push(item);
      else allByProperty.set(key, [item]);
    }
    for (const [key, list] of allByProperty) {
      readinessByProperty.set(key, getPropertyReadiness(list));
    }
  }

  // Apply filters
  let items = applyCleaningFilters(data, filters);

  // Search reaches into history: while a guest-name search is active, past
  // reservations that match are auto-revealed (the click-to-load counter and
  // the active-cards-only property gate below are bypassed for them).
  const searchActive = filters.search.trim().length > 0;
  
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

  if (items.length === 0 && !(searchActive && pastItems.length > 0)) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No active reservations found
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

  // Filter out properties with no cards after timeline filter. While
  // searching, properties whose only matches are past reservations join the
  // list too (their rows render past cards only).
  let filteredProperties = sortedProperties.filter(
    property => groupedByProperty[property].length > 0
  );
  if (searchActive) {
    const merged = new Set(filteredProperties);
    Object.keys(pastByProperty).forEach((p) => merged.add(p));
    filteredProperties = Array.from(merged).sort((a, b) => a.localeCompare(b));
  }

  if (filteredProperties.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No reservations match the selected filters
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
  //     system. Task status never affects color — the bar shows stay
  //     progress and the "N tasks" line just counts the window's tasks.
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

    return `${glassBase} bg-[var(--turnover-purple-bg)] border border-[var(--turnover-purple-border)]`;
  };

  // Card width — compact by design (~half the original footprint).
  const cardWidth = 'w-[200px]';

  // Stay progress: how much of the reservation has elapsed, as a wall-clock
  // fraction of [check_in, check_out]. A 24-night stay 12 nights in reads
  // 50%. Upcoming stays clamp to 0, past stays to 100; null (no bar) when
  // either date is missing or the range is degenerate.
  const stayProgressPct = (item: Turnover, isPast: boolean): number | null => {
    if (isPast) return 100;
    if (!item.check_in || !item.check_out) return null;
    const start = new Date(item.check_in).getTime();
    const end = new Date(item.check_out).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100));
  };

  // Render a single turnover card
  const renderCard = (item: Turnover, isFirstInRow: boolean, isPast: boolean) => {
    return (
      <Card
        key={item.id}
        onClick={() => onCardClick(item)}
        className={`group cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 ease-out !flex !flex-col !p-3 gap-2 flex-shrink-0 ${cardWidth} ${getCardStyles(isFirstInRow, item.check_in, isPast)} relative overflow-hidden rounded-xl`}
      >
        {/* Dismiss button for past cards. Hidden while searching — searched-in
            past cards aren't counter-revealed, so there's nothing to dismiss. */}
        {isPast && !searchActive && (
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

        {/* 1) Guest name. The old occupancy badge is gone — the property
            readiness icon on the row header carries that signal now. */}
        <p className={`line-clamp-1 text-sm font-medium ${item.kind === 'owner_stay' ? 'text-amber-700 dark:text-amber-400' : ''}`}>
          {item.kind === 'owner_stay' ? 'Owner Stay' : (item.guest_name || 'No Guest')}
        </p>

        {/* 2) Task count — mirrors the detail panel's "Associated" count
            (all tasks in the turnover window, no status filtering). */}
        {(item.tasks || []).length > 0 && (
          <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
            {(item.tasks || []).length} task{(item.tasks || []).length !== 1 ? 's' : ''}
          </p>
        )}

        {/* Spacer to push footer content to bottom */}
        <div className="flex-grow" />

        {/* 3) Stay progress bar — elapsed fraction of the reservation, NOT
            task completion (task detail lives in the reservation panel). */}
        {(() => {
          const pct = stayProgressPct(item, isPast);
          if (pct === null) return null;
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

        {/* 5) Check-in → Check-out — plain inline text (no badge chrome),
            muted neutral in both themes and on every card state. */}
        <div className="flex w-full justify-between text-xs text-neutral-600 dark:text-neutral-400">
          <div className={`flex items-center gap-1 ${!item.check_in ? 'opacity-40' : ''}`}>
            <LogIn className="w-3.5 h-3.5" />
            <span>{formatDate(item.check_in) || 'In'}</span>
          </div>
          <div className={`flex items-center gap-1 ${!item.check_out ? 'opacity-40' : ''}`}>
            <LogOut className="w-3.5 h-3.5" />
            <span>{formatDate(item.check_out) || 'Out'}</span>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div>
      {filteredProperties.map((propertyName) => {
        // May be empty during a search whose only matches for this property
        // are past reservations.
        const activeCards = groupedByProperty[propertyName] || [];
        const pastPool = pastByProperty[propertyName] || [];
        const shownPastCount = pastCount[propertyName] || 0;
        // Searching auto-reveals every matching past card; otherwise take the
        // N most-recent clicked into view. Reversed for chronological display.
        const pastToShow = searchActive
          ? [...pastPool].reverse()
          : pastPool.slice(0, shownPastCount).reverse();
        const hasMorePast = pastPool.length > shownPastCount;
        const shownCount = activeCards.length + (searchActive ? pastToShow.length : 0);

        return (
          <div key={propertyName}>
            {/* Property Header with inline separator. The readiness icon
                (same derivation + colors as the Timeline's property column)
                sits left of every property name so the column of icons
                reads as an aligned status rail. */}
            <div className="flex items-center gap-3">
              {(() => {
                const readiness = readinessByProperty.get(propertyName) ?? null;
                if (!readiness) return <span className="w-3.5 shrink-0" />;
                return readiness.state === 'occupied' ? (
                  <BedDouble
                    className="w-3.5 h-3.5 shrink-0 text-[#6366F1] dark:text-[#818CF8]"
                    aria-label="Occupied"
                  >
                    <title>Occupied</title>
                  </BedDouble>
                ) : readiness.state === 'ready' ? (
                  <CircleCheck
                    className="w-3.5 h-3.5 shrink-0 text-[#4C4869] dark:text-[#6e6a8a]"
                    aria-label="Ready"
                  >
                    <title>Ready</title>
                  </CircleCheck>
                ) : (
                  <Loader
                    className="w-3.5 h-3.5 shrink-0 text-[#dc4a3a] dark:text-[#d97757]"
                    aria-label="Needs attention"
                  >
                    <title>{`Needs attention (${readiness.completed}/${readiness.total} readiness tasks complete)`}</title>
                  </Loader>
                );
              })()}
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 shrink-0">
                {propertyName}
              </h3>
              <div className="flex-1 h-px bg-neutral-300/30 dark:bg-white/10" />
              <span className="text-xs text-neutral-500/70 dark:text-neutral-400/60 shrink-0">
                {shownCount} reservation{shownCount !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* Horizontal Scrollable Row with ScrollArea */}
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-4 py-4 items-stretch">
                {/* Load Past Button / Alignment Spacer. Hidden while
                    searching — matching past cards are already revealed. */}
                {pastPool.length > 0 && !searchActive ? (
                  <button
                    onClick={() => loadOnePast(propertyName)}
                    disabled={!hasMorePast}
                    className={`flex-shrink-0 flex items-center justify-center w-8 rounded-xl transition-all ${
                      hasMorePast
                        ? 'hover:bg-white/40 dark:hover:bg-white/10 hover:backdrop-blur-sm cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                        : 'text-neutral-300/50 dark:text-neutral-700/50 cursor-default'
                    }`}
                    title={hasMorePast ? `Load previous reservation (${pastPool.length - shownPastCount} more)` : 'No more past reservations'}
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
                {activeCards.map((item: Turnover, index: number) =>
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
