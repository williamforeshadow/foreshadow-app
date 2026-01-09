'use client';

import { Button } from '@/components/ui/button';
import { ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItemRight,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CleaningFilters } from '@/lib/types';

interface TurnoverFilterBarProps {
  filters: CleaningFilters;
  toggleFilter: (category: keyof CleaningFilters, value: string) => void;
  clearAllFilters: () => void;
  getActiveFilterCount: () => number;
}

export function TurnoverFilterBar({
  filters,
  toggleFilter,
  clearAllFilters,
  getActiveFilterCount,
}: TurnoverFilterBarProps) {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Turnover Status Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                Turnover Status
                {filters.turnoverStatus.length > 0 && (
                  <span className="text-muted-foreground">({filters.turnoverStatus.length})</span>
                )}
                <ChevronDownIcon className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItemRight
                checked={filters.turnoverStatus.includes('not_started')}
                onCheckedChange={() => toggleFilter('turnoverStatus', 'not_started')}
              >
                Not Started
              </DropdownMenuCheckboxItemRight>
              <DropdownMenuCheckboxItemRight
                checked={filters.turnoverStatus.includes('in_progress')}
                onCheckedChange={() => toggleFilter('turnoverStatus', 'in_progress')}
              >
                In Progress
              </DropdownMenuCheckboxItemRight>
              <DropdownMenuCheckboxItemRight
                checked={filters.turnoverStatus.includes('complete')}
                onCheckedChange={() => toggleFilter('turnoverStatus', 'complete')}
              >
                Complete
              </DropdownMenuCheckboxItemRight>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Occupancy Status Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                Occupancy
                {filters.occupancyStatus.length > 0 && (
                  <span className="text-muted-foreground">({filters.occupancyStatus.length})</span>
                )}
                <ChevronDownIcon className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItemRight
                checked={filters.occupancyStatus.includes('occupied')}
                onCheckedChange={() => toggleFilter('occupancyStatus', 'occupied')}
              >
                Occupied
              </DropdownMenuCheckboxItemRight>
              <DropdownMenuCheckboxItemRight
                checked={filters.occupancyStatus.includes('vacant')}
                onCheckedChange={() => toggleFilter('occupancyStatus', 'vacant')}
              >
                Vacant
              </DropdownMenuCheckboxItemRight>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Timeline Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                Timeline
                {filters.timeline.length > 0 && (
                  <span className="text-muted-foreground">({filters.timeline.length})</span>
                )}
                <ChevronDownIcon className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItemRight
                checked={filters.timeline.includes('active')}
                onCheckedChange={() => toggleFilter('timeline', 'active')}
              >
                Active
              </DropdownMenuCheckboxItemRight>
              <DropdownMenuCheckboxItemRight
                checked={filters.timeline.includes('upcoming')}
                onCheckedChange={() => toggleFilter('timeline', 'upcoming')}
              >
                Upcoming
              </DropdownMenuCheckboxItemRight>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear Filters */}
          {getActiveFilterCount() > 0 && (
            <button
              onClick={clearAllFilters}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Clear All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

