'use client';

import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TaskFilters, TaskSummary, TimelineFilter, DateRangeFilter } from '@/lib/useTasks';
import type { TaskStatus, TaskType } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TaskFilterBarProps {
  filters: TaskFilters;
  summary: TaskSummary | null;
  taskCount: number;
  sortBy: string;
  toggleStatusFilter: (status: TaskStatus) => void;
  toggleTypeFilter: (type: TaskType) => void;
  toggleTimelineFilter: (timeline: TimelineFilter) => void;
  setSearchQuery: (query: string) => void;
  setDateRange: (dateRange: DateRangeFilter) => void;
  setScheduledDateRange: (dateRange: DateRangeFilter) => void;
  clearFilters: () => void;
  getActiveFilterCount: () => number;
  setSortBy: (sortBy: 'created_at' | 'scheduled_start' | 'property_name' | 'status') => void;
}

export function TaskFilterBar({
  filters,
  summary,
  taskCount,
  sortBy,
  toggleStatusFilter,
  toggleTypeFilter,
  toggleTimelineFilter,
  setSearchQuery,
  setDateRange,
  setScheduledDateRange,
  clearFilters,
  getActiveFilterCount,
  setSortBy,
}: TaskFilterBarProps) {
  // Convert internal dateRange to react-day-picker DateRange format
  const calendarDateRange: DateRange | undefined = 
    filters.dateRange.from || filters.dateRange.to
      ? { from: filters.dateRange.from ?? undefined, to: filters.dateRange.to ?? undefined }
      : undefined;

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setDateRange({
      from: range?.from ?? null,
      to: range?.to ?? null
    });
  };

  // Convert internal scheduledDateRange to react-day-picker DateRange format
  const calendarScheduledRange: DateRange | undefined = 
    filters.scheduledDateRange.from || filters.scheduledDateRange.to
      ? { from: filters.scheduledDateRange.from ?? undefined, to: filters.scheduledDateRange.to ?? undefined }
      : undefined;

  const handleScheduledDateRangeSelect = (range: DateRange | undefined) => {
    setScheduledDateRange({
      from: range?.from ?? null,
      to: range?.to ?? null
    });
  };
  return (
    <div className="flex-shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-700 space-y-3">
      {/* Search and summary row */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input
            type="text"
            placeholder="Search tasks..."
            value={filters.searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {summary && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">
              {taskCount} tasks
            </span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-neutral-600 dark:text-neutral-300">{summary.complete}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-neutral-600 dark:text-neutral-300">{summary.in_progress}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-neutral-300" />
              <span className="text-neutral-600 dark:text-neutral-300">{summary.not_started}</span>
            </div>
          </div>
        )}
      </div>

      {/* Filter chips row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Timeline filters (Active/Inactive) */}
        <div className="flex items-center gap-1">
          {(['active', 'inactive'] as TimelineFilter[]).map(timeline => (
            <button
              key={timeline}
              onClick={() => toggleTimelineFilter(timeline)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filters.timeline.includes(timeline)
                  ? timeline === 'active' 
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-neutral-500 text-white border-neutral-500'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'
              }`}
            >
              {timeline}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />

        {/* Status filters */}
        <div className="flex items-center gap-1">
          {(['not_started', 'in_progress', 'complete'] as TaskStatus[]).map(status => (
            <button
              key={status}
              onClick={() => toggleStatusFilter(status)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filters.status.includes(status)
                  ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'
              }`}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />

        {/* Type filters */}
        <div className="flex items-center gap-1">
          {(['cleaning', 'maintenance'] as TaskType[]).map(type => (
            <button
              key={type}
              onClick={() => toggleTypeFilter(type)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filters.type.includes(type)
                  ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />

        {/* Turnover Date Range Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'h-7 px-2.5 text-xs font-normal justify-start',
                !calendarDateRange && 'text-neutral-500',
                calendarDateRange && 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
              )}
            >
              <CalendarIcon className="mr-1.5 h-3 w-3" />
              {calendarDateRange?.from ? (
                calendarDateRange.to ? (
                  <>
                    {format(calendarDateRange.from, 'MMM d')} – {format(calendarDateRange.to, 'MMM d')}
                  </>
                ) : (
                  format(calendarDateRange.from, 'MMM d')
                )
              ) : (
                'Turnover dates'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={calendarDateRange?.from}
              selected={calendarDateRange}
              onSelect={handleDateRangeSelect}
              numberOfMonths={2}
            />
            {calendarDateRange && (
              <div className="p-2 border-t border-neutral-200 dark:border-neutral-700">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setDateRange({ from: null, to: null })}
                >
                  Clear dates
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Scheduled Date Range Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'h-7 px-2.5 text-xs font-normal justify-start',
                !calendarScheduledRange && 'text-neutral-500',
                calendarScheduledRange && 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
              )}
            >
              <CalendarIcon className="mr-1.5 h-3 w-3" />
              {calendarScheduledRange?.from ? (
                calendarScheduledRange.to ? (
                  <>
                    {format(calendarScheduledRange.from, 'MMM d')} – {format(calendarScheduledRange.to, 'MMM d')}
                  </>
                ) : (
                  format(calendarScheduledRange.from, 'MMM d')
                )
              ) : (
                'Scheduled dates'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={calendarScheduledRange?.from}
              selected={calendarScheduledRange}
              onSelect={handleScheduledDateRangeSelect}
              numberOfMonths={2}
            />
            {calendarScheduledRange && (
              <div className="p-2 border-t border-neutral-200 dark:border-neutral-700">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setScheduledDateRange({ from: null, to: null })}
                >
                  Clear dates
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {getActiveFilterCount() > 0 && (
          <>
            <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />
            <button
              onClick={clearFilters}
              className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Clear filters
            </button>
          </>
        )}

        {/* Sort dropdown */}
        <div className="ml-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'created_at' | 'scheduled_start' | 'property_name' | 'status')}
            className="text-xs bg-transparent border border-neutral-200 dark:border-neutral-700 rounded px-2 py-1 text-neutral-600 dark:text-neutral-300"
          >
            <option value="created_at">Newest first</option>
            <option value="scheduled_start">By schedule</option>
            <option value="property_name">By property</option>
            <option value="status">By status</option>
          </select>
        </div>
      </div>
    </div>
  );
}

