'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import AssignmentIcon from '@/components/icons/AssignmentIcon';
import HammerIcon from '@/components/icons/HammerIcon';
import type { Task, Project } from '@/lib/types';
import type { AppUser } from '@/lib/useUsers';
import styles from './DayKanban.module.css';
import { DynamicBoard, type DynamicBoardFilters } from './DynamicBoard';

// DnD Kit imports
import {
  DndContext,
  DragOverlay,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useKanbanDnd } from '@/lib/hooks/useKanbanDnd';
import type { KanbanItemProps, KanbanColumnDataProps } from '@/lib/kanban-helpers';

interface DayKanbanProps {
  date: Date;
  tasks: (Task & { property_name: string })[];
  projects: Project[];
  users: AppUser[];
  onClose: () => void;
  onTaskClick?: (task: Task, propertyName: string) => void;
  onProjectClick?: (project: Project, propertyName: string) => void;
  onColumnMove?: (itemType: 'task' | 'project', itemId: string, changes: {
    assigneeId?: string | null;      // string = set, null = clear, undefined = no change
    scheduledDate?: string | null;   // YYYY-MM-DD string = set, null = clear, undefined = no change
    scheduledTime?: string | null;   // HH:MM string = set, null = clear, undefined = no change
  }) => void;
  isFullScreen?: boolean;
  /** All tasks for dynamic board filtering (optional - falls back to scheduled tasks) */
  allTasks?: (Task & { property_name: string })[];
  /** All projects for dynamic board filtering (optional - falls back to scheduled projects) */
  allProjects?: Project[];
  /** All property names for filtering */
  properties?: string[];
}

// Helper to check if two dates are the same day
const isSameDay = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

// Format date for display
const formatDateHeader = (date: Date) => {
  return date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
};

// Draggable item type - extends KanbanItemProps for dnd-kit
interface DraggableKanbanItem extends KanbanItemProps {
  id: string;
  columnId: string;
  type: 'task' | 'project';
  data: (Task & { property_name: string }) | Project;
  originalItemId: string; // The actual task_id or project id
}

// Column type for dnd-kit
interface KanbanColumn extends KanbanColumnDataProps {
  id: string;
  name: string;
  user?: AppUser;
}

export function DayKanban({
  date,
  tasks,
  projects,
  users,
  onClose,
  onTaskClick,
  onProjectClick,
  onColumnMove,
  isFullScreen = false,
  allTasks,
  allProjects,
  properties = [],
}: DayKanbanProps) {
  // Format date as YYYY-MM-DD string (use local date, not UTC, to avoid timezone shifts)
  const kanbanDateStr = useMemo(() => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [date]);

  // Filter tasks and projects for this specific day
  const dayTasks = useMemo(() => {
    return tasks.filter(task => {
      if (!task.scheduled_date) return false;
      return task.scheduled_date === kanbanDateStr;
    });
  }, [tasks, kanbanDateStr]);

  const dayProjects = useMemo(() => {
    return projects.filter(project => {
      if (!project.scheduled_date) return false;
      return project.scheduled_date === kanbanDateStr;
    });
  }, [projects, kanbanDateStr]);

  // State for dynamic board filters
  const [dynamicBoardFilters, setDynamicBoardFilters] = useState<DynamicBoardFilters | null>(null);

  // Build columns array for dnd-kit
  const columns: KanbanColumn[] = useMemo(() => {
    const cols: KanbanColumn[] = users.map(user => ({
      id: user.id,
      name: user.name,
      user,
    }));
    // Add dynamic-board column (replaces unassigned)
    cols.push({ id: 'dynamic-board', name: 'Dynamic Board' });
    return cols;
  }, [users]);

  // Filter items for dynamic board based on filters
  const dynamicBoardItems = useMemo(() => {
    const results: DraggableKanbanItem[] = [];
    const tasksToFilter = allTasks || tasks;
    const projectsToFilter = allProjects || projects;
    
    // Use default filters if none set
    const filters = dynamicBoardFilters || {
      itemType: 'all' as const,
      properties: [],
      statuses: [],
      priorities: [],
      assignees: [],
      date: null as string | null,
      searchQuery: '',
      showUnassignedOnly: true,
    };

    // Filter tasks
    if (filters.itemType === 'all' || filters.itemType === 'tasks') {
      tasksToFilter.forEach(task => {
        // Search query
        if (filters.searchQuery) {
          const query = filters.searchQuery.toLowerCase();
          const matchesSearch = 
            task.template_name?.toLowerCase().includes(query) ||
            task.property_name?.toLowerCase().includes(query) ||
            task.guest_name?.toLowerCase().includes(query);
          if (!matchesSearch) return;
        }

        // Property filter
        if (filters.properties.length > 0 && !filters.properties.includes(task.property_name || '')) {
          return;
        }

        // Status filter
        if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) {
          return;
        }

        // Assignee filter (when not showing unassigned only)
        if (filters.assignees.length > 0 && !filters.showUnassignedOnly) {
          const taskAssigneeIds = task.assigned_users?.map(u => u.user_id) || [];
          const hasMatchingAssignee = filters.assignees.some(id => taskAssigneeIds.includes(id));
          if (!hasMatchingAssignee) return;
        }

        // Unassigned only filter
        if (filters.showUnassignedOnly && task.assigned_users && task.assigned_users.length > 0) {
          return;
        }

        // Date filter: show items matching the selected date, or only unscheduled if no date
        if (filters.date) {
          // A date is selected: show only items for that exact date
          if (task.scheduled_date !== filters.date) return;
        } else {
          // No date selected: show only unscheduled items
          if (task.scheduled_date) return;
        }

        results.push({
          id: `task-${task.task_id}-dynamic`,
          columnId: 'dynamic-board',
          type: 'task',
          data: task as Task & { property_name: string },
          originalItemId: task.task_id,
        });
      });
    }

    // Filter projects
    if (filters.itemType === 'all' || filters.itemType === 'projects') {
      projectsToFilter.forEach(project => {
        // Search query
        if (filters.searchQuery) {
          const query = filters.searchQuery.toLowerCase();
          const matchesSearch = 
            project.title?.toLowerCase().includes(query) ||
            project.property_name?.toLowerCase().includes(query) ||
            project.description?.toLowerCase().includes(query);
          if (!matchesSearch) return;
        }

        // Property filter
        if (filters.properties.length > 0 && !filters.properties.includes(project.property_name)) {
          return;
        }

        // Status filter
        if (filters.statuses.length > 0 && !filters.statuses.includes(project.status)) {
          return;
        }

        // Priority filter
        if (filters.priorities.length > 0 && !filters.priorities.includes(project.priority)) {
          return;
        }

        // Assignee filter (when not showing unassigned only)
        if (filters.assignees.length > 0 && !filters.showUnassignedOnly) {
          const projectAssigneeIds = project.assigned_user_ids || [];
          const hasMatchingAssignee = filters.assignees.some(id => projectAssigneeIds.includes(id));
          if (!hasMatchingAssignee) return;
        }

        // Unassigned only filter
        if (filters.showUnassignedOnly && project.assigned_user_ids && project.assigned_user_ids.length > 0) {
          return;
        }

        // Date filter: show items matching the selected date, or only unscheduled if no date
        if (filters.date) {
          // A date is selected: show only items for that exact date
          if (project.scheduled_date !== filters.date) return;
        } else {
          // No date selected: show only unscheduled items
          if (project.scheduled_date) return;
        }

        results.push({
          id: `project-${project.id}-dynamic`,
          columnId: 'dynamic-board',
          type: 'project',
          data: project,
          originalItemId: project.id,
        });
      });
    }

    return results;
  }, [allTasks, allProjects, tasks, projects, dynamicBoardFilters, kanbanDateStr]);

  // Transform tasks/projects into flat draggable items array (for user columns only)
  const userColumnItems = useMemo(() => {
    const items: DraggableKanbanItem[] = [];
    
    // Add tasks - if assigned to multiple users, only show once per unique assignment
    dayTasks.forEach(task => {
      if (task.assigned_users && task.assigned_users.length > 0) {
        // For each assigned user, create an item (but we'll dedupe if same user)
        const addedUsers = new Set<string>();
        task.assigned_users.forEach(assignedUser => {
          if (!addedUsers.has(assignedUser.user_id)) {
            addedUsers.add(assignedUser.user_id);
            items.push({
              id: `task-${task.task_id}-${assignedUser.user_id}`,
              columnId: assignedUser.user_id,
              type: 'task',
              data: task,
              originalItemId: task.task_id,
            });
          }
        });
      }
      // Note: Unassigned items are now handled by dynamicBoardItems
    });

    // Add projects
    dayProjects.forEach(project => {
      const assignedUserIds = project.project_assignments?.map(a => a.user_id) || [];
      
      if (assignedUserIds.length > 0) {
        const addedUsers = new Set<string>();
        assignedUserIds.forEach(userId => {
          if (!addedUsers.has(userId)) {
            addedUsers.add(userId);
            items.push({
              id: `project-${project.id}-${userId}`,
              columnId: userId,
              type: 'project',
              data: project,
              originalItemId: project.id,
            });
          }
        });
      }
      // Note: Unassigned items are now handled by dynamicBoardItems
    });

    return items;
  }, [dayTasks, dayProjects]);

  // Combine user column items with dynamic board items, sorted by scheduled_time within each column
  const initialItems = useMemo(() => {
    const combined = [...userColumnItems, ...dynamicBoardItems];

    // Group items by column
    const byColumn = new Map<string, DraggableKanbanItem[]>();
    combined.forEach(item => {
      const list = byColumn.get(item.columnId) || [];
      list.push(item);
      byColumn.set(item.columnId, list);
    });

    // Sort each column's items: no time first (top), then earliest → latest
    byColumn.forEach(columnItems => {
      columnItems.sort((a, b) => {
        const timeA = (a.data as any).scheduled_time as string | null | undefined;
        const timeB = (b.data as any).scheduled_time as string | null | undefined;

        if (!timeA && !timeB) return 0;
        if (!timeA) return -1; // no time → top
        if (!timeB) return 1;  // no time → top
        return timeA.localeCompare(timeB); // "08:00" < "14:00"
      });
    });

    // Flatten back
    return Array.from(byColumn.values()).flat();
  }, [userColumnItems, dynamicBoardItems]);

  // Local state for drag operations
  const [items, setItems] = useState<DraggableKanbanItem[]>(initialItems);

  // Update items when initialItems change (e.g., when data updates)
  useMemo(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Handle column change (assignment + schedule changes on drag between columns)
  const handleColumnChange = useCallback((itemId: string, oldColumnId: string, newColumnId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const fromDynamic = oldColumnId === 'dynamic-board';
    const toDynamic = newColumnId === 'dynamic-board';
    // Extract existing scheduled_time to preserve it across date changes
    const existingTime = (item.data as any).scheduled_time as string | null | undefined;

    if (fromDynamic && !toDynamic) {
      // Dynamic board → Assignee board
      // Change assignee to the target user + change date to the kanban day view date
      // Preserve existing scheduled_time
      onColumnMove?.(item.type, item.originalItemId, {
        assigneeId: newColumnId,
        scheduledDate: kanbanDateStr,
        scheduledTime: existingTime ?? undefined,
      });
    } else if (!fromDynamic && toDynamic) {
      // Assignee board → Dynamic board
      // Only change the date — do NOT touch the assignee
      const dynamicDate = dynamicBoardFilters?.date || null;
      if (dynamicDate) {
        // Dynamic board has a date selected — reschedule to that date, preserve time
        onColumnMove?.(item.type, item.originalItemId, {
          scheduledDate: dynamicDate,
          scheduledTime: existingTime ?? undefined,
        });
      } else {
        // Dynamic board has no date selected (showing unscheduled) — unschedule it
        onColumnMove?.(item.type, item.originalItemId, {
          scheduledDate: null,
          scheduledTime: null,
        });
      }
    } else {
      // Assignee board → Assignee board (just change assignee, no date change)
      onColumnMove?.(item.type, item.originalItemId, {
        assigneeId: newColumnId,
      });
    }
  }, [items, onColumnMove, kanbanDateStr, dynamicBoardFilters]);

  // Check if an item can be moved to a target column
  // Prevents duplicates when a task/project has multiple assignees
  const canMoveToColumn = useCallback((item: DraggableKanbanItem, targetColumnId: string): boolean => {
    // Check if target column already has an item with the same originalItemId
    const targetColumnItems = items.filter(i => i.columnId === targetColumnId);
    const hasDuplicate = targetColumnItems.some(
      i => i.originalItemId === item.originalItemId && i.id !== item.id
    );
    return !hasDuplicate;
  }, [items]);

  // Use the kanban dnd hook
  const {
    activeItem,
    sensors,
    announcements,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useKanbanDnd<DraggableKanbanItem, KanbanColumn>({
    data: items,
    columns,
    enabled: true,
    onDataChange: setItems,
    onColumnChange: handleColumnChange,
    canMoveToColumn,
  });

  // Group items by column for rendering
  const itemsByColumn = useMemo(() => {
    const grouped: Record<string, DraggableKanbanItem[]> = {};
    columns.forEach(col => {
      grouped[col.id] = items.filter(item => item.columnId === col.id);
    });
    return grouped;
  }, [items, columns]);

  // Track which columns are actively shown (persistent - don't remove when emptied)
  const [activeColumnIds, setActiveColumnIds] = useState<Set<string>>(() => {
    // Initialize with columns that have items + always include dynamic-board
    const initial = new Set<string>(['dynamic-board']);
    items.forEach(item => {
      initial.add(item.columnId);
    });
    return initial;
  });

  // Update active columns when items change (add new columns, but don't remove empty ones)
  useEffect(() => {
    setActiveColumnIds(prev => {
      const newSet = new Set(prev);
      // Always ensure dynamic-board is included
      newSet.add('dynamic-board');
      // Add any columns that have items
      items.forEach(item => {
        newSet.add(item.columnId);
      });
      return newSet;
    });
  }, [items]);

  // Visible columns based on activeColumnIds, sorted with dynamic-board first
  const visibleColumns = useMemo(() => {
    const cols = columns.filter(col => activeColumnIds.has(col.id));
    // Sort: dynamic-board first, then alphabetically by name
    return cols.sort((a, b) => {
      if (a.id === 'dynamic-board') return -1;
      if (b.id === 'dynamic-board') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [columns, activeColumnIds]);

  // Users not yet added as columns (for the "+" dropdown)
  const availableUsers = useMemo(() => {
    return users.filter(user => !activeColumnIds.has(user.id));
  }, [users, activeColumnIds]);

  // Add a user column
  const addUserColumn = useCallback((userId: string) => {
    setActiveColumnIds(prev => new Set([...prev, userId]));
  }, []);

  const totalItems = dayTasks.length + dayProjects.length;

  // Render card helper for DynamicBoard
  const renderDynamicBoardCard = useCallback((cardItem: { id: string; type: 'task' | 'project'; task?: Task; project?: Project }) => {
    // Find the actual draggable item
    const item = items.find(i => i.originalItemId === cardItem.id && i.columnId === 'dynamic-board');
    if (!item) return null;
    
    return (
      <SortableKanbanCard
        key={item.id}
        item={item}
        onTaskClick={onTaskClick}
        onProjectClick={onProjectClick}
      />
    );
  }, [items, onTaskClick, onProjectClick]);

  // Render the kanban board content (shared between modal and full-screen)
  const renderKanbanContent = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements }}
    >
      <div className={isFullScreen ? styles.boardFullScreen : styles.board}>
        {/* Columns */}
        {visibleColumns.map(column => {
          // Special handling for dynamic-board column
          if (column.id === 'dynamic-board') {
            return (
              <DynamicBoard
                key={column.id}
                allTasks={(allTasks || tasks) as Task[]}
                allProjects={allProjects || projects}
                properties={properties}
                users={users}
                kanbanDate={kanbanDateStr}
                columnItems={itemsByColumn[column.id]?.map(i => ({ 
                  id: i.originalItemId, 
                  type: i.type 
                })) || []}
                renderCard={renderDynamicBoardCard}
                onFiltersChange={setDynamicBoardFilters}
                initialFilters={dynamicBoardFilters || undefined}
              />
            );
          }

          // Regular user columns
          return (
            <div key={column.id} className={styles.column}>
              {/* Column Header */}
              <div className={styles.columnHeader}>
                {column.user ? (
                  <UserAvatar
                    src={column.user.avatar}
                    name={column.user.name}
                    size="sm"
                  />
                ) : (
                  <div className={styles.unassignedAvatar}>?</div>
                )}
                <div className={styles.columnHeaderInfo}>
                  <p className={styles.columnTitle}>
                    {column.user?.name || 'Unassigned'}
                  </p>
                  {column.user && (
                    <p className={styles.columnRole}>{column.user.role}</p>
                  )}
                </div>
                <span className={styles.columnCount}>
                  {itemsByColumn[column.id]?.length || 0}
                </span>
              </div>

              {/* Column Cards - Sortable Context */}
              <SortableContext
                items={itemsByColumn[column.id]?.map(i => i.id) || []}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn columnId={column.id}>
                  {itemsByColumn[column.id]?.map((item) => (
                    <SortableKanbanCard
                      key={item.id}
                      item={item}
                      onTaskClick={onTaskClick}
                      onProjectClick={onProjectClick}
                    />
                  ))}
                </DroppableColumn>
              </SortableContext>
            </div>
          );
        })}

        {/* Add User Column Button */}
        {availableUsers.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className={styles.addColumnButton} title="Add user column">
                <Plus className="w-5 h-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className={styles.addColumnPopover} align="start">
              <p className={styles.addColumnTitle}>Add User Column</p>
              <div className={styles.addColumnList}>
                {availableUsers.map(user => (
                  <button
                    key={user.id}
                    className={styles.addColumnItem}
                    onClick={() => addUserColumn(user.id)}
                  >
                    <UserAvatar
                      src={user.avatar}
                      name={user.name}
                      size="sm"
                    />
                    <div className={styles.addColumnItemInfo}>
                      <span className={styles.addColumnItemName}>{user.name}</span>
                      <span className={styles.addColumnItemRole}>{user.role}</span>
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Empty state only if no columns at all */}
        {visibleColumns.length === 0 && (
          <div className={styles.emptyState}>
            No items scheduled for this day
          </div>
        )}
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeItem ? (
          <KanbanCardContent
            item={activeItem}
            isDragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );

  // Full-screen mode - no overlay, embedded in parent
  if (isFullScreen) {
    return (
      <div className={styles.containerFullScreen}>
        {/* Header for full-screen */}
        <div className={styles.headerFullScreen}>
          <div className={styles.headerContent}>
            <h2 className={styles.headerTitle}>{formatDateHeader(date)}</h2>
            <p className={styles.headerSubtitle}>
              {totalItems} item{totalItems !== 1 ? 's' : ''} scheduled
              {dayTasks.length > 0 && ` • ${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''}`}
              {dayProjects.length > 0 && ` • ${dayProjects.length} project${dayProjects.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {renderKanbanContent()}
      </div>
    );
  }

  // Modal mode - with overlay
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <h2 className={styles.headerTitle}>{formatDateHeader(date)}</h2>
            <p className={styles.headerSubtitle}>
              {totalItems} item{totalItems !== 1 ? 's' : ''} scheduled
              {dayTasks.length > 0 && ` • ${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''}`}
              {dayProjects.length > 0 && ` • ${dayProjects.length} project${dayProjects.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <Button variant="ghost" size="icon" className={styles.closeButton} onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        {renderKanbanContent()}
      </div>
    </div>
  );
}

// Droppable column wrapper
function DroppableColumn({
  columnId,
  children,
}: {
  columnId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  
  return (
    <div 
      ref={setNodeRef}
      className={cn(styles.columnContent, isOver && styles.columnOver)}
    >
      {children}
    </div>
  );
}

// Sortable wrapper for cards
function SortableKanbanCard({
  item,
  onTaskClick,
  onProjectClick,
}: {
  item: DraggableKanbanItem;
  onTaskClick?: (task: Task, propertyName: string) => void;
  onProjectClick?: (project: Project, propertyName: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only trigger click if not dragging
    if (isDragging) return;
    
    if (item.type === 'task' && onTaskClick) {
      const task = item.data as Task & { property_name: string };
      onTaskClick(task, task.property_name);
    } else if (item.type === 'project' && onProjectClick) {
      const project = item.data as Project;
      onProjectClick(project, project.property_name);
    }
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
    >
      <KanbanCardContent
        item={item}
        isDragging={isDragging}
      />
    </div>
  );
}

// Card content (used both in sortable and overlay)
function KanbanCardContent({
  item,
  isDragging = false,
}: {
  item: DraggableKanbanItem;
  isDragging?: boolean;
}) {
  const isTask = item.type === 'task';
  const task = isTask ? (item.data as Task & { property_name: string }) : null;
  const project = !isTask ? (item.data as Project) : null;

  // Collect assignees from task or project
  const assignees: { id: string; name: string; avatar?: string }[] = [];
  if (isTask && task?.assigned_users) {
    task.assigned_users.forEach(u => {
      assignees.push({ id: u.user_id, name: u.name, avatar: u.avatar });
    });
  } else if (!isTask && project?.project_assignments) {
    project.project_assignments.forEach(a => {
      assignees.push({
        id: a.user_id,
        name: a.user?.name || '?',
        avatar: a.user?.avatar,
      });
    });
  }

  const getStatusClass = (status: string | undefined) => {
    switch (status) {
      case 'complete': return styles.statusComplete;
      case 'in_progress': return styles.statusInProgress;
      case 'on_hold': return styles.statusOnHold;
      case 'paused': return styles.statusPaused;
      case 'reopened': return styles.statusReopened;
      default: return styles.statusNotStarted;
    }
  };

  return (
    <div
      className={cn(
        styles.card,
        isTask ? styles.cardTask : styles.cardProject,
        isDragging && styles.cardDragging
      )}
    >
      {/* Card Header */}
      <div className={styles.cardHeader}>
        <div className={cn(styles.cardIcon, isTask ? styles.cardIconTask : styles.cardIconProject)}>
          {isTask ? (
            <AssignmentIcon size={12} />
          ) : (
            <HammerIcon size={12} />
          )}
        </div>
        <div className={styles.cardContent}>
          <p className={styles.cardTitle}>
            {isTask ? (task?.template_name || task?.type) : project?.title}
          </p>
          <p className={styles.cardProperty}>
            {isTask ? task?.property_name : project?.property_name}
          </p>
        </div>
      </div>

      {/* Card Footer */}
      <div className={styles.cardFooter}>
        {/* Status + Time grouped left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span className={cn(styles.statusBadge, getStatusClass(isTask ? task?.status : project?.status))}>
            {(isTask ? task?.status : project?.status)?.replace('_', ' ')}
          </span>
          {(() => {
            const time = isTask ? task?.scheduled_time : project?.scheduled_time;
            if (!time) return null;
            const [h, m] = time.split(':').map(Number);
            const ampm = h >= 12 ? 'pm' : 'am';
            const h12 = h % 12 || 12;
            return (
              <span style={{ fontSize: '0.625rem', color: '#a3a3a3', whiteSpace: 'nowrap' }}>
                {h12}:{String(m).padStart(2, '0')}{ampm}
              </span>
            );
          })()}
        </div>
        {/* Assignee avatars */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {assignees.length > 0 ? (
            <>
              {assignees.slice(0, 3).map((user, index) => (
                <div
                  key={user.id}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: '#404040',
                    border: '2px solid #373737',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.5rem',
                    fontWeight: 600,
                    color: '#a3a3a3',
                    marginLeft: index > 0 ? '-6px' : '0',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                  title={user.name}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  )}
                </div>
              ))}
              {assignees.length > 3 && (
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: '#525252',
                    border: '2px solid #373737',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.5rem',
                    fontWeight: 600,
                    color: '#a3a3a3',
                    marginLeft: '-6px',
                    flexShrink: 0,
                  }}
                >
                  +{assignees.length - 3}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
