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
  onAssignmentChange?: (itemType: 'task' | 'project', itemId: string, newUserId: string | null) => void;
  isFullScreen?: boolean;
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
  onAssignmentChange,
  isFullScreen = false,
}: DayKanbanProps) {
  // Filter tasks and projects for this specific day
  const dayTasks = useMemo(() => {
    return tasks.filter(task => {
      if (!task.scheduled_start) return false;
      return isSameDay(new Date(task.scheduled_start), date);
    });
  }, [tasks, date]);

  const dayProjects = useMemo(() => {
    return projects.filter(project => {
      if (!project.scheduled_start) return false;
      return isSameDay(new Date(project.scheduled_start), date);
    });
  }, [projects, date]);

  // Build columns array for dnd-kit
  const columns: KanbanColumn[] = useMemo(() => {
    const cols: KanbanColumn[] = users.map(user => ({
      id: user.id,
      name: user.name,
      user,
    }));
    // Add unassigned column
    cols.push({ id: 'unassigned', name: 'Unassigned' });
    return cols;
  }, [users]);

  // Transform tasks/projects into flat draggable items array
  const initialItems = useMemo(() => {
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
      } else {
        items.push({
          id: `task-${task.task_id}-unassigned`,
          columnId: 'unassigned',
          type: 'task',
          data: task,
          originalItemId: task.task_id,
        });
      }
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
      } else {
        items.push({
          id: `project-${project.id}-unassigned`,
          columnId: 'unassigned',
          type: 'project',
          data: project,
          originalItemId: project.id,
        });
      }
    });

    return items;
  }, [dayTasks, dayProjects]);

  // Local state for drag operations
  const [items, setItems] = useState<DraggableKanbanItem[]>(initialItems);

  // Update items when initialItems change (e.g., when data updates)
  useMemo(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Handle column change (assignment change)
  const handleColumnChange = useCallback((itemId: string, oldColumnId: string, newColumnId: string) => {
    const item = items.find(i => i.id === itemId);
    if (item && onAssignmentChange) {
      const newUserId = newColumnId === 'unassigned' ? null : newColumnId;
      onAssignmentChange(item.type, item.originalItemId, newUserId);
    }
  }, [items, onAssignmentChange]);

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
    // Initialize with columns that have items + always include unassigned
    const initial = new Set<string>(['unassigned']);
    items.forEach(item => {
      initial.add(item.columnId);
    });
    return initial;
  });

  // Update active columns when items change (add new columns, but don't remove empty ones)
  useEffect(() => {
    setActiveColumnIds(prev => {
      const newSet = new Set(prev);
      // Always ensure unassigned is included
      newSet.add('unassigned');
      // Add any columns that have items
      items.forEach(item => {
        newSet.add(item.columnId);
      });
      return newSet;
    });
  }, [items]);

  // Visible columns based on activeColumnIds, sorted with unassigned first
  const visibleColumns = useMemo(() => {
    const cols = columns.filter(col => activeColumnIds.has(col.id));
    // Sort: unassigned first, then alphabetically by name
    return cols.sort((a, b) => {
      if (a.id === 'unassigned') return -1;
      if (b.id === 'unassigned') return 1;
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
        {visibleColumns.map(column => (
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
        ))}

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
        <span className={cn(styles.statusBadge, getStatusClass(isTask ? task?.status : project?.status))}>
          {(isTask ? task?.status : project?.status)?.replace('_', ' ')}
        </span>
        <span className={styles.cardType}>
          {isTask ? 'Task' : 'Project'}
        </span>
      </div>
    </div>
  );
}
