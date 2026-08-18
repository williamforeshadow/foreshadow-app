'use client';

import { useState } from 'react';
import { Filter as FilterIcon } from 'lucide-react';
import { CompactSearch } from '@/components/ui/compact-search';
import { type FilterOption } from '@/components/tasks/TaskFilterBar';
import { DrillDownFilterPicker } from '@/components/tasks/TaskPickers';
import type { CleaningFilters } from '@/lib/types';

// Turnovers filter/search bar — search-icon toggle (guest names) + a filter
// funnel opening the standard drill-in picker (anchored popover on desktop,
// bottom drawer on mobile) with the three turnover-relevant axes:
//   - Occupancy (occupied / checked out)
//   - Schedule (active / upcoming) — formerly "Timeline"
//   - Property (multi-select, populated from the cards response)
//
// All state lives in `useTurnovers` (via the `filters` object); this bar is
// purely controlled.

interface TurnoverFilterBarProps {
  filters: CleaningFilters;
  setFilterValues: (
    category: 'occupancyStatus' | 'timeline' | 'properties',
    values: string[]
  ) => void;
  setSearch: (value: string) => void;
  clearAllFilters: () => void;
  getActiveFilterCount: () => number;
  propertyOptions: FilterOption[];
}

const OCCUPANCY_OPTIONS: FilterOption[] = [
  { value: 'occupied', label: 'Occupied' },
  { value: 'vacant', label: 'Checked Out' },
];

const SCHEDULE_OPTIONS: FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'upcoming', label: 'Upcoming' },
];

export function TurnoverFilterBar({
  filters,
  setFilterValues,
  setSearch,
  clearAllFilters,
  propertyOptions,
}: TurnoverFilterBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="flex h-[var(--window-header-row-h)] items-center gap-2 min-w-0 flex-nowrap">
      <CompactSearch
        value={filters.search}
        onChange={setSearch}
        placeholder="Search guests…"
      />

      <DrillDownFilterPicker
        open={filterOpen}
        onOpenChange={setFilterOpen}
        onClearAll={clearAllFilters}
        renderTrigger={(activeCount) => (
          <button
            type="button"
            title={filterOpen ? 'Hide filters' : 'Show filters'}
            aria-pressed={filterOpen}
            className={`relative flex-shrink-0 p-1.5 rounded transition-colors ${
              filterOpen || activeCount > 0
                ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]'
            }`}
          >
            <FilterIcon className="w-4 h-4" />
            {activeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] rounded-full bg-[var(--accent-3)] dark:bg-[var(--accent-2)] text-white dark:text-[#1a1a1a] text-[9px] font-semibold tabular-nums px-1">
                {activeCount}
              </span>
            )}
          </button>
        )}
        axes={[
          {
            id: 'occupancy',
            label: 'Occupancy',
            options: OCCUPANCY_OPTIONS,
            selected: new Set(filters.occupancyStatus),
            onChange: (next) => setFilterValues('occupancyStatus', Array.from(next)),
          },
          {
            id: 'schedule',
            label: 'Schedule',
            options: SCHEDULE_OPTIONS,
            selected: new Set(filters.timeline),
            onChange: (next) => setFilterValues('timeline', Array.from(next)),
          },
          {
            id: 'property',
            label: 'Property',
            options: propertyOptions,
            selected: new Set(filters.properties),
            onChange: (next) => setFilterValues('properties', Array.from(next)),
            searchable: true,
          },
        ]}
      />
    </div>
  );
}
