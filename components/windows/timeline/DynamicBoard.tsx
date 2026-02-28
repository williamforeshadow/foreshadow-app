'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { 
  Filter, 
  ChevronDown, 
  Search, 
  X, 
  Calendar, 
  Home, 
  User, 
  AlertCircle,
  CheckCircle2,
  Clock,
  Pause,
  RotateCcw,
  Layers,
  FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Task, Project, TaskStatus, ProjectStatus, ProjectPriority, User as UserType } from '@/lib/types';
import styles from './DynamicBoard.module.css';

// =============================================================================
// Types
// =============================================================================

export interface DynamicBoardFilters {
  itemType: 'all' | 'tasks' | 'projects';
  properties: string[];
  statuses: string[];
  priorities: ProjectPriority[];
  assignees: string[]; // user IDs
  date: string | null; // Single date filter — shows items for this date + unscheduled items
  searchQuery: string;
  showUnassignedOnly: boolean;
}

export interface DynamicBoardProps {
  /** All tasks available in the system */
  allTasks: Task[];
  /** All projects available in the system */
  allProjects: Project[];
  /** List of all properties for filtering */
  properties: string[];
  /** List of all users for assignee filtering */
  users: UserType[];
  /** Current kanban date (for default filter) */
  kanbanDate: string;
  /** Items currently in this column (from dnd-kit) - these are already filtered by parent */
  columnItems: Array<{ id: string; type: 'task' | 'project' }>;
  /** Whether column is being dragged over */
  isOver?: boolean;
  /** Render a single card item - called by parent to render sortable cards */
  renderCard: (item: { id: string; type: 'task' | 'project'; task?: Task; project?: Project }) => React.ReactNode;
  /** Callback when filters change - parent uses this to filter items */
  onFiltersChange?: (filters: DynamicBoardFilters) => void;
  /** Initial filters (optional - for persistence) */
  initialFilters?: Partial<DynamicBoardFilters>;
}

// =============================================================================
// Default Filters
// =============================================================================

const getDefaultFilters = (kanbanDate: string): DynamicBoardFilters => ({
  itemType: 'all',
  properties: [],
  statuses: [],
  priorities: [],
  assignees: [],
  date: null, // null = show unscheduled items only (no date filter)
  searchQuery: '',
  showUnassignedOnly: true, // Default to showing unassigned items
});

// =============================================================================
// Status/Priority Options
// =============================================================================

const TASK_STATUSES: { value: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'contingent', label: 'Contingent', icon: <FileText className="h-3 w-3 text-neutral-400" /> },
  { value: 'not_started', label: 'Not Started', icon: <AlertCircle className="h-3 w-3 text-red-500" /> },
  { value: 'in_progress', label: 'In Progress', icon: <Clock className="h-3 w-3 text-yellow-500" /> },
  { value: 'paused', label: 'Paused', icon: <Pause className="h-3 w-3 text-orange-500" /> },
  { value: 'complete', label: 'Complete', icon: <CheckCircle2 className="h-3 w-3 text-green-500" /> },
  { value: 'reopened', label: 'Reopened', icon: <RotateCcw className="h-3 w-3 text-purple-500" /> },
];

const PROJECT_STATUSES: { value: ProjectStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'not_started', label: 'Not Started', icon: <AlertCircle className="h-3 w-3 text-red-500" /> },
  { value: 'in_progress', label: 'In Progress', icon: <Clock className="h-3 w-3 text-yellow-500" /> },
  { value: 'on_hold', label: 'On Hold', icon: <Pause className="h-3 w-3 text-orange-500" /> },
  { value: 'complete', label: 'Complete', icon: <CheckCircle2 className="h-3 w-3 text-green-500" /> },
];

const PRIORITIES: { value: ProjectPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-slate-500' },
  { value: 'medium', label: 'Medium', color: 'bg-sky-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-500' },
];

// =============================================================================
// Component
// =============================================================================

export function DynamicBoard({
  allTasks,
  allProjects,
  properties,
  users,
  kanbanDate,
  columnItems,
  isOver,
  renderCard,
  onFiltersChange,
  initialFilters,
}: DynamicBoardProps) {
  // ---------------------------------------------------------------------------
  // Filter State
  // ---------------------------------------------------------------------------
  const [filters, setFilters] = useState<DynamicBoardFilters>(() => ({
    ...getDefaultFilters(kanbanDate),
    ...initialFilters,
  }));

  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');

  // Track current filters in a ref so callbacks always have the latest value
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Ref for the hidden date input so we can trigger its native picker
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Notify parent on mount so it knows the initial filters
  useEffect(() => {
    onFiltersChange?.(filtersRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update filters and notify parent directly (only called from event handlers)
  const updateFilters = useCallback((updates: Partial<DynamicBoardFilters>) => {
    const newFilters = { ...filtersRef.current, ...updates };
    setFilters(newFilters);
    onFiltersChange?.(newFilters);
  }, [onFiltersChange]);

  // Reset to defaults
  const resetFilters = useCallback(() => {
    const defaults = getDefaultFilters(kanbanDate);
    setFilters(defaults);
    onFiltersChange?.(defaults);
  }, [kanbanDate, onFiltersChange]);

  // Note: Filtering is done in the parent component (DayKanban)
  // columnItems contains the already-filtered items to display

  // ---------------------------------------------------------------------------
  // Active Filter Count (for badge)
  // ---------------------------------------------------------------------------
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.itemType !== 'all') count++;
    if (filters.properties.length > 0) count++;
    if (filters.statuses.length > 0) count++;
    if (filters.priorities.length > 0) count++;
    if (filters.assignees.length > 0) count++;
    if (filters.searchQuery) count++;
    if (!filters.showUnassignedOnly) count++; // Non-default
    return count;
  }, [filters]);

  // ---------------------------------------------------------------------------
  // Droppable Setup
  // ---------------------------------------------------------------------------
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: 'dynamic-board',
  });

  const combinedIsOver = isOver || isDroppableOver;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Layers className="h-4 w-4 text-neutral-400" />
          <span className={styles.title}>Dynamic Board</span>
          <Badge variant="secondary" className={styles.countBadge}>
            {columnItems.length}
          </Badge>
        </div>
        
        <div className={styles.headerRight}>
          {/* Search */}
          <div className={styles.searchContainer}>
            <Search className="h-3 w-3 text-neutral-500" />
            <Input
              type="text"
              placeholder="Search..."
              value={filters.searchQuery}
              onChange={(e) => updateFilters({ searchQuery: e.target.value })}
              className={styles.searchInput}
            />
            {filters.searchQuery && (
              <button
                onClick={() => updateFilters({ searchQuery: '' })}
                className={styles.clearSearch}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Filter Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={cn(styles.filterButton, showFilterPanel && styles.filterButtonActive)}
          >
            <Filter className="h-3.5 w-3.5" />
            {activeFilterCount > 0 && (
              <span className={styles.filterBadge}>{activeFilterCount}</span>
            )}
          </Button>

          {/* Calendar Date Picker — native input, no popover */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <input
              ref={dateInputRef}
              type="date"
              value={filters.date || ''}
              onChange={(e) => {
                updateFilters({ date: e.target.value || null });
              }}
              style={{
                position: 'absolute',
                width: 0,
                height: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dateInputRef.current?.showPicker?.()}
              className={cn(styles.filterButton, filters.date && styles.filterButtonActive)}
            >
              <Calendar className="h-3.5 w-3.5" />
            </Button>
            {filters.date && (
              <>
                <span style={{ fontSize: '0.6875rem', color: '#a0a0d0', whiteSpace: 'nowrap' }}>
                  {filters.date}
                </span>
                <button
                  onClick={() => updateFilters({ date: null })}
                  className={styles.clearSearch}
                  title="Clear date"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilterPanel && (
        <div className={styles.filterPanel}>
          {/* Item Type */}
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Type</label>
            <div className={styles.filterChips}>
              {(['all', 'tasks', 'projects'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => updateFilters({ itemType: type })}
                  className={cn(
                    styles.filterChip,
                    filters.itemType === type && styles.filterChipActive
                  )}
                >
                  {type === 'all' ? 'All' : type === 'tasks' ? 'Tasks' : 'Projects'}
                </button>
              ))}
            </div>
          </div>

          {/* Unassigned Toggle */}
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Assignment</label>
            <div className={styles.filterChips}>
              <button
                onClick={() => updateFilters({ showUnassignedOnly: true })}
                className={cn(
                  styles.filterChip,
                  filters.showUnassignedOnly && styles.filterChipActive
                )}
              >
                Unassigned Only
              </button>
              <button
                onClick={() => updateFilters({ showUnassignedOnly: false })}
                className={cn(
                  styles.filterChip,
                  !filters.showUnassignedOnly && styles.filterChipActive
                )}
              >
                All Items
              </button>
            </div>
          </div>

          {/* Property Filter */}
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>
              <Home className="h-3 w-3" /> Properties
            </label>
            <DropdownMenu onOpenChange={(open) => { if (!open) setPropertySearch(''); }}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={styles.dropdownTrigger}>
                  {filters.properties.length === 0 
                    ? 'All Properties' 
                    : `${filters.properties.length} selected`}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className={styles.dropdownContent}>
                <div className="px-2 py-1.5">
                  <div className={styles.searchContainer}>
                    <Search className="h-3 w-3 text-neutral-500" />
                    <input
                      type="text"
                      placeholder="Search properties..."
                      value={propertySearch}
                      onChange={(e) => setPropertySearch(e.target.value)}
                      className={styles.searchInput}
                      style={{ width: '100%' }}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    {propertySearch && (
                      <button onClick={() => setPropertySearch('')} className={styles.clearSearch}>
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                <DropdownMenuSeparator />
                {properties
                  .filter(prop => prop.toLowerCase().includes(propertySearch.toLowerCase()))
                  .map(prop => (
                    <DropdownMenuCheckboxItem
                      key={prop}
                      checked={filters.properties.includes(prop)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({ properties: [...filters.properties, prop] });
                        } else {
                          updateFilters({ properties: filters.properties.filter(p => p !== prop) });
                        }
                      }}
                    >
                      {prop}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Status Filter */}
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Status</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={styles.dropdownTrigger}>
                  {filters.statuses.length === 0 
                    ? 'All Statuses' 
                    : `${filters.statuses.length} selected`}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className={styles.dropdownContent}>
                <DropdownMenuLabel>Task Statuses</DropdownMenuLabel>
                {TASK_STATUSES.map(status => (
                  <DropdownMenuCheckboxItem
                    key={`task-${status.value}`}
                    checked={filters.statuses.includes(status.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        updateFilters({ statuses: [...filters.statuses, status.value] });
                      } else {
                        updateFilters({ statuses: filters.statuses.filter(s => s !== status.value) });
                      }
                    }}
                  >
                    <span className="flex items-center gap-2">
                      {status.icon}
                      {status.label}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Project Statuses</DropdownMenuLabel>
                {PROJECT_STATUSES.filter(s => !['not_started', 'in_progress', 'complete'].includes(s.value)).map(status => (
                  <DropdownMenuCheckboxItem
                    key={`project-${status.value}`}
                    checked={filters.statuses.includes(status.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        updateFilters({ statuses: [...filters.statuses, status.value] });
                      } else {
                        updateFilters({ statuses: filters.statuses.filter(s => s !== status.value) });
                      }
                    }}
                  >
                    <span className="flex items-center gap-2">
                      {status.icon}
                      {status.label}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Priority Filter (Projects only) */}
          {(filters.itemType === 'all' || filters.itemType === 'projects') && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Priority</label>
              <div className={styles.filterChips}>
                {PRIORITIES.map(priority => (
                  <button
                    key={priority.value}
                    onClick={() => {
                      if (filters.priorities.includes(priority.value)) {
                        updateFilters({ priorities: filters.priorities.filter(p => p !== priority.value) });
                      } else {
                        updateFilters({ priorities: [...filters.priorities, priority.value] });
                      }
                    }}
                    className={cn(
                      styles.filterChip,
                      filters.priorities.includes(priority.value) && styles.filterChipActive,
                      filters.priorities.includes(priority.value) && priority.color
                    )}
                  >
                    {priority.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assignee Filter */}
          {!filters.showUnassignedOnly && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>
                <User className="h-3 w-3" /> Assignees
              </label>
              <DropdownMenu onOpenChange={(open) => { if (!open) setAssigneeSearch(''); }}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className={styles.dropdownTrigger}>
                    {filters.assignees.length === 0 
                      ? 'All Assignees' 
                      : `${filters.assignees.length} selected`}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className={styles.dropdownContent}>
                  <div className="px-2 py-1.5">
                    <div className={styles.searchContainer}>
                      <Search className="h-3 w-3 text-neutral-500" />
                      <input
                        type="text"
                        placeholder="Search assignees..."
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        className={styles.searchInput}
                        style={{ width: '100%' }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      {assigneeSearch && (
                        <button onClick={() => setAssigneeSearch('')} className={styles.clearSearch}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  {users
                    .filter(user => user.name.toLowerCase().includes(assigneeSearch.toLowerCase()))
                    .map(user => (
                      <DropdownMenuCheckboxItem
                        key={user.id}
                        checked={filters.assignees.includes(user.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            updateFilters({ assignees: [...filters.assignees, user.id] });
                          } else {
                            updateFilters({ assignees: filters.assignees.filter(a => a !== user.id) });
                          }
                        }}
                      >
                        {user.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Reset Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className={styles.resetButton}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset Filters
          </Button>
        </div>
      )}

      {/* Droppable Content Area */}
      <div 
        ref={setNodeRef}
        className={cn(
          styles.content,
          combinedIsOver && styles.contentOver
        )}
      >
        {columnItems.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No items match your filters</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="mt-2"
            >
              Reset Filters
            </Button>
          </div>
        ) : (
          columnItems.map(item => renderCard(item))
        )}
      </div>
    </div>
  );
}

export default DynamicBoard;
