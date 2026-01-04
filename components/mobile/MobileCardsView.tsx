'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import TurnoverCards from '@/components/TurnoverCards';
import type { CleaningFilters } from '@/lib/cleaningFilters';

interface MobileCardsViewProps {
  data: any[] | null;
  filters: CleaningFilters;
  sortBy: string;
  onFiltersChange: (filters: CleaningFilters) => void;
  onSortChange: (sort: string) => void;
  onCardClick: (card: any) => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

export default function MobileCardsView({
  data,
  filters,
  sortBy,
  onFiltersChange,
  onSortChange,
  onCardClick,
  onRefresh,
  isLoading,
}: MobileCardsViewProps) {
  const [showFilters, setShowFilters] = useState(false);

  const turnoverCount = data?.length || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky Header Container - contains title + filters bar */}
      <div className="sticky top-0 z-30 bg-white dark:bg-neutral-900">
        {/* Turnovers Title */}
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
              Turnovers
              <Badge variant="secondary" className="ml-2 text-xs">
                {turnoverCount}
              </Badge>
            </h2>
          </div>
        </div>

        {/* Filters Action Bar */}
        <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </Button>
        </div>

        {/* Filters Panel (collapsible) - also sticky */}
        {showFilters && (
          <div className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700 px-4 py-3">
            <MobileTurnoverFilters 
              filters={filters}
              onChange={onFiltersChange}
              sortBy={sortBy}
              onSortChange={onSortChange}
            />
          </div>
        )}
      </div>

      {/* Cards Content - scrollable */}
      <div className="flex-1 overflow-auto px-4 py-4 hide-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-neutral-500 dark:text-neutral-400">Loading...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <TurnoverCards
              data={data}
              filters={filters}
              sortBy={sortBy}
              onCardClick={onCardClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Mobile-optimized filter components
function MobileTurnoverFilters({ 
  filters, 
  onChange,
  sortBy,
  onSortChange 
}: { 
  filters: CleaningFilters; 
  onChange: (f: CleaningFilters) => void;
  sortBy: string;
  onSortChange: (s: string) => void;
}) {
  const statusOptions = [
    { value: 'not_started', label: 'Not Started', color: 'bg-red-500' },
    { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-500' },
    { value: 'complete', label: 'Complete', color: 'bg-emerald-500' },
  ];

  const occupancyOptions = [
    { value: 'occupied', label: 'Occupied', color: 'bg-orange-500' },
    { value: 'vacant', label: 'Vacant', color: 'bg-neutral-400' },
  ];

  const sortOptions = [
    { value: 'status-priority', label: 'Status Priority' },
    { value: 'checkin-soonest', label: 'Check-in: Soonest' },
    { value: 'checkout-recent', label: 'Checkout: Recent' },
    { value: 'property-az', label: 'Property Name' },
  ];

  const toggleTurnoverStatus = (status: string) => {
    const newStatuses = filters.turnoverStatus.includes(status)
      ? filters.turnoverStatus.filter(s => s !== status)
      : [...filters.turnoverStatus, status];
    onChange({ ...filters, turnoverStatus: newStatuses });
  };

  const toggleOccupancyStatus = (status: string) => {
    const newStatuses = filters.occupancyStatus.includes(status)
      ? filters.occupancyStatus.filter(s => s !== status)
      : [...filters.occupancyStatus, status];
    onChange({ ...filters, occupancyStatus: newStatuses });
  };

  const toggleTimeline = (value: string) => {
    const newValues = filters.timeline.includes(value)
      ? filters.timeline.filter(v => v !== value)
      : [...filters.timeline, value];
    onChange({ ...filters, timeline: newValues });
  };

  const timelineOptions = [
    { value: 'active', label: 'Active' },
    { value: 'upcoming', label: 'Upcoming' },
  ];

  return (
    <div className="space-y-3">
      {/* Sort By */}
      <div>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Sort By</label>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
        >
          {sortOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Turnover Status Filter */}
      <div>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 block">Turnover Status</label>
        <div className="flex flex-wrap gap-2">
          {statusOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleTurnoverStatus(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
                filters.turnoverStatus.includes(opt.value)
                  ? 'bg-purple-500 text-white border-purple-500'
                  : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${opt.color}`} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Occupancy Status Filter */}
      <div>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 block">Occupancy Status</label>
        <div className="flex flex-wrap gap-2">
          {occupancyOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleOccupancyStatus(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
                filters.occupancyStatus.includes(opt.value)
                  ? 'bg-purple-500 text-white border-purple-500'
                  : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${opt.color}`} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Filter */}
      <div>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 block">Timeline</label>
        <div className="flex flex-wrap gap-2">
          {timelineOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleTimeline(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                filters.timeline.includes(opt.value)
                  ? 'bg-purple-500 text-white border-purple-500'
                  : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      {(filters.turnoverStatus.length > 0 || filters.occupancyStatus.length > 0 || filters.timeline.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ turnoverStatus: [], occupancyStatus: [], timeline: [] })}
          className="text-xs"
        >
          Clear All Filters
        </Button>
      )}
    </div>
  );
}
