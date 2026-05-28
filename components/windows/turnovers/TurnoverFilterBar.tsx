'use client';

import { useState } from 'react';
import { Filter as FilterIcon } from 'lucide-react';
import { CompactSearch } from '@/components/ui/compact-search';
import { ChipScrollLane } from '@/components/ui/chip-scroll-lane';
import { MultiSelect, type FilterOption } from '@/components/tasks/TaskFilterBar';
import type { CleaningFilters } from '@/lib/types';

// Turnovers filter/search bar — mirrors the Schedule page bar: a search-icon
// toggle (guest names) + a filter funnel that collapses the chip row, with
// pill-style multi-select chips for the four turnover-relevant axes.
//
// Filter axes (varying field set vs. Schedule):
//   - Reservation Tasks (turnoverStatus)
//   - Occupancy (occupied / checked out)
//   - Schedule (active / upcoming) — formerly "Timeline"
//   - Property (multi-select, populated from the cards response)
//
// All state lives in `useTurnovers` (via the `filters` object); this bar is
// purely controlled.

interface TurnoverFilterBarProps {
  filters: CleaningFilters;
  setFilterValues: (
    category: 'turnoverStatus' | 'occupancyStatus' | 'timeline' | 'properties',
    values: string[]
  ) => void;
  setSearch: (value: string) => void;
  clearAllFilters: () => void;
  getActiveFilterCount: () => number;
  propertyOptions: FilterOption[];
}

const RESERVATION_TASK_OPTIONS: FilterOption[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
];

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
  getActiveFilterCount,
  propertyOptions,
}: TurnoverFilterBarProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const anyFilterActive = getActiveFilterCount() > 0;

  return (
    <div className="flex items-center gap-2 min-w-0 flex-nowrap">
      <CompactSearch
        value={filters.search}
        onChange={setSearch}
        placeholder="Search guests…"
      />

      <button
        type="button"
        onClick={() => setFiltersExpanded((v) => !v)}
        title={filtersExpanded ? 'Hide filters' : 'Show filters'}
        aria-pressed={filtersExpanded}
        className={`flex-shrink-0 p-1.5 rounded transition-colors ${
          filtersExpanded || anyFilterActive
            ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
            : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]'
        }`}
      >
        <FilterIcon className="w-4 h-4" />
      </button>

      {filtersExpanded && (
        <>
          {/* Chip lane: chevron-driven scroll so long property names or many
              active filters never push the row to a second line. The Clear
              button stays outside the lane so it remains visible. */}
          <ChipScrollLane>
            <MultiSelect
              label="Reservation Tasks"
              options={RESERVATION_TASK_OPTIONS}
              selected={new Set(filters.turnoverStatus)}
              onChange={(next) => setFilterValues('turnoverStatus', Array.from(next))}
            />
            <MultiSelect
              label="Occupancy"
              options={OCCUPANCY_OPTIONS}
              selected={new Set(filters.occupancyStatus)}
              onChange={(next) => setFilterValues('occupancyStatus', Array.from(next))}
            />
            <MultiSelect
              label="Schedule"
              options={SCHEDULE_OPTIONS}
              selected={new Set(filters.timeline)}
              onChange={(next) => setFilterValues('timeline', Array.from(next))}
            />
            <MultiSelect
              label="Property"
              options={propertyOptions}
              selected={new Set(filters.properties)}
              onChange={(next) => setFilterValues('properties', Array.from(next))}
              searchable
            />
          </ChipScrollLane>
          {anyFilterActive && (
            <button
              onClick={clearAllFilters}
              className="flex-shrink-0 text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.04em] px-2 py-1 rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-700 dark:hover:text-[#f0efed] transition-colors"
            >
              Clear
            </button>
          )}
        </>
      )}
    </div>
  );
}
