'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import CleaningCards from '@/components/CleaningCards';
import MaintenanceCards from '@/components/MaintenanceCards';
import type { CleaningFilters } from '@/lib/cleaningFilters';
import type { MaintenanceFilters } from '@/lib/maintenanceFilters';

interface MobileCardsViewProps {
  // Cleaning data
  cleaningData: any[] | null;
  cleaningFilters: CleaningFilters;
  cleaningSortBy: string;
  onCleaningFiltersChange: (filters: CleaningFilters) => void;
  onCleaningSortChange: (sort: string) => void;
  
  // Maintenance data
  maintenanceData: any[];
  maintenanceFilters: MaintenanceFilters;
  maintenanceSortBy: string;
  onMaintenanceFiltersChange: (filters: MaintenanceFilters) => void;
  onMaintenanceSortChange: (sort: string) => void;
  
  // Shared
  onCardClick: (card: any) => void;
  onCreateMaintenance: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

export default function MobileCardsView({
  cleaningData,
  cleaningFilters,
  cleaningSortBy,
  onCleaningFiltersChange,
  onCleaningSortChange,
  maintenanceData,
  maintenanceFilters,
  maintenanceSortBy,
  onMaintenanceFiltersChange,
  onMaintenanceSortChange,
  onCardClick,
  onCreateMaintenance,
  onRefresh,
  isLoading,
}: MobileCardsViewProps) {
  const [viewMode, setViewMode] = useState<'cleanings' | 'maintenance'>('cleanings');
  const [showFilters, setShowFilters] = useState(false);

  const cleaningCount = cleaningData?.length || 0;
  const maintenanceCount = maintenanceData?.length || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Tab Switcher */}
      <div className="sticky top-14 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2">
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'cleanings' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('cleanings')}
            className="flex-1"
          >
            Cleanings
            <Badge variant="secondary" className="ml-2 text-xs">
              {cleaningCount}
            </Badge>
          </Button>
          <Button
            variant={viewMode === 'maintenance' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('maintenance')}
            className="flex-1"
          >
            Maintenance
            <Badge variant="secondary" className="ml-2 text-xs">
              {maintenanceCount}
            </Badge>
          </Button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="sticky top-[7.5rem] z-20 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 flex items-center justify-between">
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
        
        <div className="flex items-center gap-2">
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
          
          {viewMode === 'maintenance' && (
            <Button
              variant="default"
              size="sm"
              onClick={onCreateMaintenance}
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New
            </Button>
          )}
        </div>
      </div>

      {/* Filters Panel (collapsible) */}
      {showFilters && (
        <div className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700 px-4 py-3">
          {viewMode === 'cleanings' ? (
            <MobileCleaningFilters 
              filters={cleaningFilters}
              onChange={onCleaningFiltersChange}
              sortBy={cleaningSortBy}
              onSortChange={onCleaningSortChange}
            />
          ) : (
            <MobileMaintenanceFilters
              filters={maintenanceFilters}
              onChange={onMaintenanceFiltersChange}
              sortBy={maintenanceSortBy}
              onSortChange={onMaintenanceSortChange}
            />
          )}
        </div>
      )}

      {/* Cards Content */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-neutral-500 dark:text-neutral-400">Loading...</div>
          </div>
        ) : viewMode === 'cleanings' ? (
          <div className="grid grid-cols-1 gap-3">
            <CleaningCards
              data={cleaningData}
              filters={cleaningFilters}
              sortBy={cleaningSortBy}
              onCardClick={onCardClick}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <MaintenanceCards
              data={maintenanceData}
              filters={maintenanceFilters}
              sortBy={maintenanceSortBy}
              onCardClick={onCardClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Mobile-optimized filter components
function MobileCleaningFilters({ 
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
    { value: 'not_started', label: 'Not Started' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' },
    { value: 'no_tasks', label: 'No Tasks' },
  ];

  const sortOptions = [
    { value: 'status-priority', label: 'Status Priority' },
    { value: 'check-out', label: 'Check Out Date' },
    { value: 'check-in', label: 'Check In Date' },
    { value: 'property', label: 'Property Name' },
  ];

  const toggleStatus = (status: string) => {
    const newStatuses = filters.cleanStatus.includes(status)
      ? filters.cleanStatus.filter(s => s !== status)
      : [...filters.cleanStatus, status];
    onChange({ ...filters, cleanStatus: newStatuses });
  };

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

      {/* Status Filter */}
      <div>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 block">Status</label>
        <div className="flex flex-wrap gap-2">
          {statusOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleStatus(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                filters.cleanStatus.includes(opt.value)
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      {(filters.cleanStatus.length > 0 || filters.cardActions.length > 0 || filters.staff.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ cleanStatus: [], cardActions: [], staff: [] })}
          className="text-xs"
        >
          Clear All Filters
        </Button>
      )}
    </div>
  );
}

function MobileMaintenanceFilters({
  filters,
  onChange,
  sortBy,
  onSortChange
}: {
  filters: MaintenanceFilters;
  onChange: (f: MaintenanceFilters) => void;
  sortBy: string;
  onSortChange: (s: string) => void;
}) {
  const priorityOptions = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];

  const sortOptions = [
    { value: 'priority-high', label: 'Priority (High First)' },
    { value: 'priority-low', label: 'Priority (Low First)' },
    { value: 'created-newest', label: 'Newest First' },
    { value: 'created-oldest', label: 'Oldest First' },
  ];

  const togglePriority = (priority: string) => {
    const newPriorities = filters.priority.includes(priority)
      ? filters.priority.filter(p => p !== priority)
      : [...filters.priority, priority];
    onChange({ ...filters, priority: newPriorities });
  };

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

      {/* Priority Filter */}
      <div>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 block">Priority</label>
        <div className="flex flex-wrap gap-2">
          {priorityOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => togglePriority(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                filters.priority.includes(opt.value)
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      {(filters.priority.length > 0 || filters.cardActions.length > 0 || filters.staff.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ priority: [], cardActions: [], staff: [], property: [] })}
          className="text-xs"
        >
          Clear All Filters
        </Button>
      )}
    </div>
  );
}

