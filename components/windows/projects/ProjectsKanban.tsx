'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import type { Project, ProjectStatus, ProjectPriority, PropertyOption, User, Department } from '@/lib/types';
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
  users?: User[];
  departments?: Department[];
  onProjectClick: (project: Project) => void;
  expandedProjectId: string | null;
  getUnreadCommentCount: (project: Project) => number;
  onColumnMove: (projectId: string, field: string, value: string) => void;
  visibleColumnIds?: Set<string>;
  onDraggingChange?: (isDragging: boolean) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export function ProjectsKanban({
  projects,
  viewMode,
  allProperties,
  users = [],
  departments = [],
  onProjectClick,
  expandedProjectId,
  getUnreadCommentCount,
  onColumnMove,
  visibleColumnIds,
  onDraggingChange,
}: ProjectsKanbanProps) {
  // Build columns based on view mode
  const allColumns: KanbanColumn[] = useMemo(() => {
    if (viewMode === 'property') {
      // One column per property, plus "No Property"
      const propertyNames = new Set<string>();
      propertyNames.add('No Property'); // Always include
      projects.forEach((p) => {
        propertyNames.add(p.property_name || 'No Property');
      });
      // Also include properties from allProperties that have no projects yet
      // (so empty columns are visible)
      allProperties.forEach((p) => {
        if (p.name) propertyNames.add(p.name);
      });

      const sorted = Array.from(propertyNames).sort((a, b) => {
        if (a === 'No Property') return -1;
        if (b === 'No Property') return 1;
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

    if (viewMode === 'priority') {
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
    }

    if (viewMode === 'department') {
      // One column per department, plus "No Department"
      const deptNames = new Set<string>();
      deptNames.add('No Department');
      projects.forEach((p) => {
        deptNames.add(p.department_name || 'No Department');
      });
      departments.forEach((d) => {
        if (d.name) deptNames.add(d.name);
      });
      const sorted = Array.from(deptNames).sort((a, b) => {
        if (a === 'No Department') return -1;
        if (b === 'No Department') return 1;
        return a.localeCompare(b);
      });
      return sorted.map((name) => ({
        id: `dept:${name}`,
        name,
      }));
    }

    // assignee
    const assigneeNames = new Set<string>();
    assigneeNames.add('Unassigned');
    projects.forEach((p) => {
      if (p.project_assignments && p.project_assignments.length > 0) {
        p.project_assignments.forEach((a) => {
          assigneeNames.add(a.user?.name || a.user_id);
        });
      } else {
        assigneeNames.add('Unassigned');
      }
    });
    users.forEach((u) => {
      if (u.name) assigneeNames.add(u.name);
    });
    const sorted = Array.from(assigneeNames).sort((a, b) => {
      if (a === 'Unassigned') return -1;
      if (b === 'Unassigned') return 1;
      return a.localeCompare(b);
    });
    return sorted.map((name) => ({
      id: `assignee:${name}`,
      name,
    }));
  }, [viewMode, projects, allProperties, departments, users]);

  // Filter columns by visibility selection
  // undefined = prop not passed, show all; empty Set = user cleared all, show none
  const columns: KanbanColumn[] = useMemo(() => {
    if (!visibleColumnIds) return allColumns;
    return allColumns.filter((col) => visibleColumnIds.has(col.id));
  }, [allColumns, visibleColumnIds]);

  // Transform projects into draggable items
  const initialItems: DraggableProjectItem[] = useMemo(() => {
    if (viewMode === 'assignee') {
      // In assignee mode, duplicate a project into each assignee's column
      const items: DraggableProjectItem[] = [];
      projects.forEach((project) => {
        const assignments = project.project_assignments || [];
        if (assignments.length === 0) {
          items.push({ id: project.id, columnId: 'assignee:Unassigned', project });
        } else {
          assignments.forEach((a, idx) => {
            const name = a.user?.name || a.user_id;
            items.push({
              id: idx === 0 ? project.id : `${project.id}__assignee_${idx}`,
              columnId: `assignee:${name}`,
              project,
            });
          });
        }
      });
      return items;
    }

    return projects.map((project) => {
      let columnId: string;
      if (viewMode === 'property') {
        columnId = `prop:${project.property_name || 'No Property'}`;
      } else if (viewMode === 'status') {
        columnId = `status:${project.status}`;
      } else if (viewMode === 'department') {
        columnId = `dept:${project.department_name || 'No Department'}`;
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

      // Strip any duplicate-assignee suffix from the item ID
      const realItemId = itemId.includes('__assignee_') ? itemId.split('__assignee_')[0] : itemId;

      if (fieldPrefix === 'prop') {
        const propName = value === 'No Property' ? '' : value;
        onColumnMove(realItemId, 'property_name', propName);
      } else if (fieldPrefix === 'status') {
        onColumnMove(realItemId, 'status', value);
      } else if (fieldPrefix === 'priority') {
        onColumnMove(realItemId, 'priority', value);
      } else if (fieldPrefix === 'dept') {
        // Find the department ID from the name
        const dept = departments.find(d => d.name === value);
        onColumnMove(realItemId, 'department_id', dept?.id || '');
      } else if (fieldPrefix === 'assignee') {
        // Find the project to get its current assignment list
        const project = projects.find(p => p.id === realItemId);
        const currentAssignments = project?.project_assignments || [];
        const currentUserIds = currentAssignments.map(a => a.user_id);

        // Parse old column to determine which user is being "removed"
        const oldValue = _oldColumnId.split(':').slice(1).join(':');
        const oldUser = users.find(u => u.name === oldValue);

        if (value === 'Unassigned') {
          // Moving to Unassigned = remove old assignee, keep the rest
          if (oldUser) {
            const newIds = currentUserIds.filter(id => id !== oldUser.id);
            onColumnMove(realItemId, 'assigned_user_ids', newIds.join(','));
          }
        } else {
          const newUser = users.find(u => u.name === value);
          if (!newUser) return;

          // If the target user is already assigned, reject the move
          if (currentUserIds.includes(newUser.id)) {
            // Revert the visual drag — put the card back in its old column
            setItems(prev =>
              prev.map(item =>
                item.id === itemId ? { ...item, columnId: _oldColumnId } : item
              )
            );
            return;
          }

          // Remove old assignee, add new one, keep everyone else
          let newIds = [...currentUserIds];
          if (oldUser) {
            newIds = newIds.filter(id => id !== oldUser.id);
          }
          newIds.push(newUser.id);
          onColumnMove(realItemId, 'assigned_user_ids', newIds.join(','));
        }
      }
    },
    [onColumnMove, departments, users, projects]
  );

  // Use the kanban DnD hook
  const { activeItem, isDragging, sensors, announcements, handleDragStart, handleDragOver, handleDragEnd } =
    useKanbanDnd<DraggableProjectItem, KanbanColumn>({
      data: items,
      columns,
      enabled: true,
      onDataChange: setItems,
      onColumnChange: handleColumnChange,
    });

  useEffect(() => {
    onDraggingChange?.(isDragging);
  }, [isDragging, onDraggingChange]);

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
      not_started: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
      in_progress: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
      on_hold: { bg: 'rgba(163,163,163,0.15)', color: '#a3a3a3' },
      complete: { bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
    };
    const c = colors[status] || colors.not_started;
    return (
      <div className={styles.columnIcon} style={{ backgroundColor: c.bg, color: c.color }}>
        {status === 'complete' ? '✓' : status === 'on_hold' ? '⏸' : '●'}
      </div>
    );
  }

  if (viewMode === 'priority') {
    const priority = columnId.replace('priority:', '') as ProjectPriority;
    const colors: Record<ProjectPriority, { bg: string; color: string }> = {
      urgent: { bg: 'rgba(239,68,68,0.15)', color: '#f87171' },
      high: { bg: 'rgba(249,115,22,0.15)', color: '#fb923c' },
      medium: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
      low: { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
    };
    const c = colors[priority] || colors.medium;
    return (
      <div className={styles.columnIcon} style={{ backgroundColor: c.bg, color: c.color }}>
        {priority === 'urgent' ? '!!' : priority === 'high' ? '!' : '●'}
      </div>
    );
  }

  if (viewMode === 'department') {
    return (
      <div className={styles.columnIcon} style={{ backgroundColor: 'rgba(133,183,235,0.15)', color: '#85B7EB' }}>
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      </div>
    );
  }

  // assignee
  return (
    <div className={styles.columnIcon} style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
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
  const { departments: allDepts } = useDepartments();
  const dept = allDepts.find(d => d.id === project.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);

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
  // Don't repeat information that's already the column header
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
          <DeptIcon className="w-3 h-3" />
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

        {/* Right: assignee avatars (hide in assignee view — column is the user) */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {viewMode !== 'assignee' && assignees.length > 0 && (
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
