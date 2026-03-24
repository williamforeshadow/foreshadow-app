'use client';

import { useMemo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import HexagonIcon from '@/components/icons/HammerIcon';
import type { Project, ProjectStatus, ProjectPriority, PropertyOption } from '@/lib/types';
import type { ProjectViewMode } from '@/lib/useProjects';
import { STATUS_LABELS, PRIORITY_LABELS, STATUS_ORDER, PRIORITY_ORDER } from '@/lib/useProjects';
import type { KanbanItemProps, KanbanColumnDataProps } from '@/lib/kanban-helpers';
import styles from './ProjectsKanban.module.css';

// DnD Kit imports
import {
  DndContext,
  DragOverlay,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useKanbanDnd } from '@/lib/hooks/useKanbanDnd';

// ============================================================================
// Types
// ============================================================================

interface DraggableProjectItem extends KanbanItemProps {
  id: string;
  columnId: string;
  project: Project;
}

interface KanbanColumn extends KanbanColumnDataProps {
  id: string;
  name: string;
  accent?: string; // CSS module class for column accent color
}

interface ProjectsKanbanProps {
  projects: Project[];
  viewMode: ProjectViewMode;
  allProperties: PropertyOption[];
  onProjectClick: (project: Project) => void;
  expandedProjectId: string | null;
  getUnreadCommentCount: (project: Project) => number;
  onColumnMove: (projectId: string, field: string, value: string) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export function ProjectsKanban({
  projects,
  viewMode,
  allProperties,
  onProjectClick,
  expandedProjectId,
  getUnreadCommentCount,
  onColumnMove,
}: ProjectsKanbanProps) {
  // Build columns based on view mode
  const columns: KanbanColumn[] = useMemo(() => {
    if (viewMode === 'property') {
      // One column per property, plus "No Property"
      const propertyNames = new Set<string>();
      projects.forEach((p) => {
        propertyNames.add(p.property_name || 'No Property');
      });
      // Also include properties from allProperties that have no projects yet
      // (so empty columns are visible)
      allProperties.forEach((p) => {
        if (p.name) propertyNames.add(p.name);
      });

      const sorted = Array.from(propertyNames).sort((a, b) => {
        if (a === 'No Property') return 1;
        if (b === 'No Property') return -1;
        return a.localeCompare(b);
      });

      return sorted.map((name) => ({
        id: `prop:${name}`,
        name,
      }));
    }

    if (viewMode === 'status') {
      return STATUS_ORDER.map((status) => ({
        id: `status:${status}`,
        name: STATUS_LABELS[status],
        accent:
          status === 'not_started'
            ? styles.columnAccentNotStarted
            : status === 'in_progress'
            ? styles.columnAccentInProgress
            : status === 'on_hold'
            ? styles.columnAccentOnHold
            : styles.columnAccentComplete,
      }));
    }

    // priority
    return PRIORITY_ORDER.map((priority) => ({
      id: `priority:${priority}`,
      name: PRIORITY_LABELS[priority],
      accent:
        priority === 'urgent'
          ? styles.columnAccentUrgent
          : priority === 'high'
          ? styles.columnAccentHigh
          : priority === 'medium'
          ? styles.columnAccentMedium
          : styles.columnAccentLow,
    }));
  }, [viewMode, projects, allProperties]);

  // Transform projects into draggable items
  const initialItems: DraggableProjectItem[] = useMemo(() => {
    return projects.map((project) => {
      let columnId: string;
      if (viewMode === 'property') {
        columnId = `prop:${project.property_name || 'No Property'}`;
      } else if (viewMode === 'status') {
        columnId = `status:${project.status}`;
      } else {
        columnId = `priority:${project.priority}`;
      }
      return {
        id: project.id,
        columnId,
        project,
      };
    });
  }, [projects, viewMode]);

  // Local state for drag operations
  const [items, setItems] = useState<DraggableProjectItem[]>(initialItems);

  // Sync items when source data changes
  useMemo(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Handle column change after drag
  const handleColumnChange = useCallback(
    (itemId: string, _oldColumnId: string, newColumnId: string) => {
      // Parse the column id to figure out what changed
      const [fieldPrefix, ...valueParts] = newColumnId.split(':');
      const value = valueParts.join(':'); // rejoin in case name had ':'

      if (fieldPrefix === 'prop') {
        // Property change - pass property_name
        const propName = value === 'No Property' ? '' : value;
        onColumnMove(itemId, 'property_name', propName);
      } else if (fieldPrefix === 'status') {
        onColumnMove(itemId, 'status', value);
      } else if (fieldPrefix === 'priority') {
        onColumnMove(itemId, 'priority', value);
      }
    },
    [onColumnMove]
  );

  // Use the kanban DnD hook
  const { activeItem, sensors, announcements, handleDragStart, handleDragOver, handleDragEnd } =
    useKanbanDnd<DraggableProjectItem, KanbanColumn>({
      data: items,
      columns,
      enabled: true,
      onDataChange: setItems,
      onColumnChange: handleColumnChange,
    });

  // Group items by column for rendering
  const itemsByColumn = useMemo(() => {
    const grouped: Record<string, DraggableProjectItem[]> = {};
    columns.forEach((col) => {
      grouped[col.id] = items.filter((item) => item.columnId === col.id);
    });
    return grouped;
  }, [items, columns]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements }}
    >
      <div className={styles.board}>
        {columns.map((column) => (
          <div key={column.id} className={cn(styles.column, column.accent)}>
            {/* Column Header */}
            <div className={styles.columnHeader}>
              <ColumnIcon viewMode={viewMode} columnId={column.id} />
              <div className={styles.columnHeaderInfo}>
                <p className={styles.columnTitle}>{column.name}</p>
              </div>
              <span className={styles.columnCount}>
                {itemsByColumn[column.id]?.length || 0}
              </span>
            </div>

            {/* Column Cards */}
            <SortableContext
              items={itemsByColumn[column.id]?.map((i) => i.id) || []}
              strategy={verticalListSortingStrategy}
            >
              <DroppableColumn columnId={column.id}>
                {itemsByColumn[column.id]?.length === 0 ? (
                  <div className={styles.emptyColumn}>No projects</div>
                ) : (
                  itemsByColumn[column.id]?.map((item) => (
                    <SortableProjectCard
                      key={item.id}
                      item={item}
                      viewMode={viewMode}
                      isSelected={expandedProjectId === item.project.id}
                      unreadCount={getUnreadCommentCount(item.project)}
                      onClick={() => onProjectClick(item.project)}
                    />
                  ))
                )}
              </DroppableColumn>
            </SortableContext>
          </div>
        ))}
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeItem ? (
          <ProjectCardContent
            item={activeItem as DraggableProjectItem}
            viewMode={viewMode}
            isDragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ============================================================================
// Column Icon
// ============================================================================

function ColumnIcon({ viewMode, columnId }: { viewMode: ProjectViewMode; columnId: string }) {
  if (viewMode === 'property') {
    // Building icon for properties
    return (
      <div className={styles.columnIcon} style={{ backgroundColor: '#404040', color: '#a3a3a3' }}>
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      </div>
    );
  }

  if (viewMode === 'status') {
    const status = columnId.replace('status:', '') as ProjectStatus;
    const colors: Record<ProjectStatus, { bg: string; color: string }> = {
      not_started: { bg: 'rgba(239,68,68,0.2)', color: '#f87171' },
      in_progress: { bg: 'rgba(234,179,8,0.2)', color: '#facc15' },
      on_hold: { bg: 'rgba(249,115,22,0.2)', color: '#fb923c' },
      complete: { bg: 'rgba(34,197,94,0.2)', color: '#4ade80' },
    };
    const c = colors[status] || colors.not_started;
    return (
      <div className={styles.columnIcon} style={{ backgroundColor: c.bg, color: c.color }}>
        {status === 'complete' ? '✓' : status === 'on_hold' ? '⏸' : '●'}
      </div>
    );
  }

  // priority
  const priority = columnId.replace('priority:', '') as ProjectPriority;
  const colors: Record<ProjectPriority, { bg: string; color: string }> = {
    urgent: { bg: 'rgba(239,68,68,0.2)', color: '#f87171' },
    high: { bg: 'rgba(249,115,22,0.2)', color: '#fb923c' },
    medium: { bg: 'rgba(59,130,246,0.2)', color: '#60a5fa' },
    low: { bg: 'rgba(100,116,139,0.2)', color: '#94a3b8' },
  };
  const c = colors[priority] || colors.medium;
  return (
    <div className={styles.columnIcon} style={{ backgroundColor: c.bg, color: c.color }}>
      {priority === 'urgent' ? '!!' : priority === 'high' ? '!' : '●'}
    </div>
  );
}

// ============================================================================
// Droppable Column Wrapper
// ============================================================================

function DroppableColumn({ columnId, children }: { columnId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div ref={setNodeRef} className={cn(styles.columnContent, isOver && styles.columnOver)}>
      {children}
    </div>
  );
}

// ============================================================================
// Sortable Card Wrapper
// ============================================================================

function SortableProjectCard({
  item,
  viewMode,
  isSelected,
  unreadCount,
  onClick,
}: {
  item: DraggableProjectItem;
  viewMode: ProjectViewMode;
  isSelected: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    onClick();
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={handleClick}>
      <ProjectCardContent
        item={item}
        viewMode={viewMode}
        isDragging={isDragging}
        isSelected={isSelected}
        unreadCount={unreadCount}
      />
    </div>
  );
}

// ============================================================================
// Card Content (used in both sortable cards and drag overlay)
// ============================================================================

function ProjectCardContent({
  item,
  viewMode,
  isDragging = false,
  isSelected = false,
  unreadCount = 0,
}: {
  item: DraggableProjectItem;
  viewMode: ProjectViewMode;
  isDragging?: boolean;
  isSelected?: boolean;
  unreadCount?: number;
}) {
  const project = item.project;

  // Assignees
  const assignees: { id: string; name: string; avatar?: string }[] = [];
  if (project.project_assignments) {
    project.project_assignments.forEach((a) => {
      assignees.push({
        id: a.user_id,
        name: a.user?.name || '?',
        avatar: a.user?.avatar,
      });
    });
  }

  const getStatusClass = (status: string | undefined) => {
    switch (status) {
      case 'complete':
        return styles.statusComplete;
      case 'in_progress':
        return styles.statusInProgress;
      case 'on_hold':
        return styles.statusOnHold;
      default:
        return styles.statusNotStarted;
    }
  };

  const getPriorityClass = (priority: string | undefined) => {
    switch (priority) {
      case 'urgent':
        return styles.priorityUrgent;
      case 'high':
        return styles.priorityHigh;
      case 'medium':
        return styles.priorityMedium;
      default:
        return styles.priorityLow;
    }
  };

  // Decide what subtitle to show based on view mode
  // In property view, don't show property name (it's already the column header)
  // In status view, don't show status (it's the column)
  // In priority view, don't show priority (it's the column)
  const subtitle =
    viewMode === 'property'
      ? null
      : project.property_name || null;

  return (
    <div
      className={cn(styles.card, isDragging && styles.cardDragging)}
      style={isSelected ? { boxShadow: '0 0 0 2px #fbbf24', borderColor: '#fbbf24' } : undefined}
    >
      {/* Unread badge */}
      {unreadCount > 0 && !isSelected && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#ef4444',
            color: '#fff',
            fontSize: '0.625rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            zIndex: 2,
          }}
        >
          {unreadCount}
        </div>
      )}

      {/* Card Header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <HexagonIcon size={12} />
        </div>
        <div className={styles.cardContent}>
          <p className={styles.cardTitle}>{project.title}</p>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
      </div>

      {/* Card Footer */}
      <div className={styles.cardFooter}>
        {/* Left: status + priority + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
          {/* Show status badge unless we're in status view */}
          {viewMode !== 'status' && (
            <span className={cn(styles.statusBadge, getStatusClass(project.status))}>
              {project.status?.replace('_', ' ')}
            </span>
          )}
          {/* Show priority badge unless we're in priority view */}
          {viewMode !== 'priority' && (
            <span className={cn(styles.priorityBadge, getPriorityClass(project.priority))}>
              {project.priority}
            </span>
          )}
          {/* Scheduled time */}
          {project.scheduled_time && (() => {
            const [h, m] = project.scheduled_time!.split(':').map(Number);
            const ampm = h >= 12 ? 'pm' : 'am';
            const h12 = h % 12 || 12;
            return (
              <span style={{ fontSize: '0.625rem', color: '#a3a3a3', whiteSpace: 'nowrap' }}>
                {h12}:{String(m).padStart(2, '0')}{ampm}
              </span>
            );
          })()}
        </div>

        {/* Right: assignee avatars */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {assignees.length > 0 && (
            <>
              {assignees.slice(0, 3).map((user, index) => (
                <div
                  key={user.id}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: '#404040',
                    border: '2px solid #373737',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.5rem',
                    fontWeight: 600,
                    color: '#a3a3a3',
                    marginLeft: index > 0 ? -6 : 0,
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
                    user.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()
                  )}
                </div>
              ))}
              {assignees.length > 3 && (
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: '#525252',
                    border: '2px solid #373737',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.5rem',
                    fontWeight: 600,
                    color: '#a3a3a3',
                    marginLeft: -6,
                    flexShrink: 0,
                  }}
                >
                  +{assignees.length - 3}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
