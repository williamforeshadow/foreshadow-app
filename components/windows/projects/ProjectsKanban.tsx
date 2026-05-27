'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Project, ProjectStatus, ProjectPriority, PropertyOption, User, Department, ProjectBin } from '@/lib/types';
import type { ProjectViewMode } from '@/lib/types';
import { STATUS_LABELS, PRIORITY_LABELS, STATUS_ORDER, PRIORITY_ORDER } from '@/lib/types';
import type { KanbanColumnDataProps } from '@/lib/kanban-helpers';
import { ProjectCard, type DraggableProjectItem } from './ProjectCard';
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
  // Bulk dismiss: called with the ids the user selected via the kanban's
  // built-in selection mode. Optional — when omitted, the selection toolbar
  // is hidden entirely (used outside of bin views where dismiss isn't
  // meaningful).
  onBulkDismiss?: (taskIds: string[]) => void | Promise<void>;
  // Selection mode is owned by the parent so the "Select" entry-point can
  // live in the parent's header toolbar (next to "+ New Task") while the
  // active selection toolbar (Cancel / Dismiss) still renders inside the
  // kanban. When either prop is omitted, selection mode is disabled.
  selectionMode?: boolean;
  onSelectionModeChange?: (next: boolean) => void;
  // Project bins — used to resolve per-card auto-dismiss settings and render
  // a countdown badge on completed cards in auto-dismiss-enabled bins.
  bins?: ProjectBin[];
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
  onBulkDismiss,
  selectionMode: selectionModeProp,
  onSelectionModeChange,
  bins,
}: ProjectsKanbanProps) {
  // `selectionMode` is owned by the parent (so the entry button can live in
  // the parent's toolbar). `selectedIds` stays local — it's an internal
  // concern tied to this board's lifecycle and gets reset automatically when
  // selection mode is exited or the underlying project list changes.
  const selectionMode = !!selectionModeProp;
  const exitSelectionMode = useCallback(() => {
    onSelectionModeChange?.(false);
  }, [onSelectionModeChange]);
  // Map bin_id → ProjectBin for O(1) lookups from card components.
  const binById = useMemo(() => {
    const m = new Map<string, ProjectBin>();
    (bins || []).forEach((b) => m.set(b.id, b));
    return m;
  }, [bins]);
  // Orphan binned tasks (is_binned=true, bin_id=null) fall under the system bin's
  // auto-dismiss config — mirrors the SQL sweep's `OR (t.bin_id IS NULL AND b.is_system = true)`.
  const systemBin = useMemo(() => (bins || []).find((b) => b.is_system), [bins]);
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
            : status === 'paused'
            ? styles.columnAccentPaused
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
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // ── Selection mode (for bulk actions like dismiss) ───────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isDismissing, setIsDismissing] = useState(false);

  // Clear selection whenever selection mode is exited from outside.
  useEffect(() => {
    if (!selectionMode) setSelectedIds(new Set());
  }, [selectionMode]);

  // Reset selection when the view mode changes (e.g. switching between bins).
  useEffect(() => {
    setSelectedIds(new Set());
  }, [viewMode]);

  // Drop ids that no longer exist in the current projects (e.g. after a
  // dismissal removed them server-side).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(projects.map((p) => p.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [projects]);

  const toggleSelected = useCallback((projectId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const handleBulkDismissClick = useCallback(async () => {
    if (!onBulkDismiss || selectedIds.size === 0) return;
    const count = selectedIds.size;
    const msg = count === 1
      ? 'Dismiss 1 task from this bin? It will no longer appear on the Kanban board.'
      : `Dismiss ${count} tasks from this bin? They will no longer appear on the Kanban board.`;
    if (!confirm(msg)) return;
    setIsDismissing(true);
    try {
      await onBulkDismiss(Array.from(selectedIds));
      setSelectedIds(new Set());
      exitSelectionMode();
    } finally {
      setIsDismissing(false);
    }
  }, [onBulkDismiss, selectedIds, exitSelectionMode]);

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
        const draggedProject = projects.find(p => p.id === realItemId);
        // Templated tasks: status is fully driven by checklist actions.
        // Block any drag-based status change and revert the visual drag.
        // This is a backup to canMoveToColumn, which already prevents the drop.
        if (draggedProject?.template_id) {
          alert('This task uses a checklist template. Open the task and use Start, Pause, Complete, or Reopen to change its status.');
          setItems([...initialItems]);
          return;
        }
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
    [onColumnMove, departments, users, projects, initialItems]
  );

  const canMoveToColumn = useCallback((item: DraggableProjectItem, targetColumnId: string) => {
    const project = item.project;

    if (viewMode === 'property') {
      const currentColumnId = `prop:${project.property_name || 'No Property'}`;
      if (targetColumnId !== currentColumnId) {
        alert('Property can\'t be changed after a task is created.');
        return false;
      }
      return true;
    }

    // Templated tasks: status is fully driven by checklist actions, so
    // silently reject any cross-column drop in status view. (Silent is
    // intentional — this callback fires repeatedly on drag-over.)
    if (viewMode === 'status' && project.template_id) {
      const currentColumnId = `status:${project.status}`;
      if (targetColumnId !== currentColumnId) return false;
    }

    return true;
  }, [viewMode]);

  // Use the kanban DnD hook
  const { activeItem, isDragging, sensors, announcements, handleDragStart, handleDragOver, handleDragEnd } =
    useKanbanDnd<DraggableProjectItem, KanbanColumn>({
      data: items,
      columns,
      // Disable drag-and-drop while in selection mode so taps register as
      // toggles, not drag starts.
      enabled: !selectionMode,
      onDataChange: setItems,
      onColumnChange: handleColumnChange,
      canMoveToColumn,
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

  const handleCardClick = useCallback((project: Project) => {
    if (selectionMode) {
      toggleSelected(project.id);
      return;
    }
    onProjectClick(project);
  }, [selectionMode, toggleSelected, onProjectClick]);

  const dismissLabel = isDismissing
    ? 'Dismissing…'
    : selectedIds.size === 1
    ? 'Dismiss 1 task from bin'
    : `Dismiss ${selectedIds.size} tasks from bin`;

  return (
    <div className={styles.kanbanContainer}>
      {/* Selection toolbar — only visible while selection mode is active.
          The entry point (a "Select" button) lives in the parent's own
          header toolbar, next to "+ New Task". */}
      {selectionMode && onBulkDismiss && (
        <div className={cn(styles.selectionBar, styles.selectionBarActive)}>
          <button
            type="button"
            onClick={exitSelectionMode}
            className={styles.selectionBarButton}
            disabled={isDismissing}
            title="Exit selection mode"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel
          </button>
          <span className={styles.selectionCount}>
            {selectedIds.size} selected
          </span>
          <div className={styles.selectionBarSpacer} />
          <button
            type="button"
            onClick={handleBulkDismissClick}
            disabled={selectedIds.size === 0 || isDismissing}
            className={styles.selectionBarPrimary}
            title="Dismiss selected tasks from this bin"
          >
            {dismissLabel}
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        accessibility={{ announcements }}
      >
        <div className={styles.board} data-kanban-board="true">
          {columns.map((column) => (
            <div key={column.id} className={cn(styles.column, column.accent)} data-kanban-column="true">
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
                    itemsByColumn[column.id]?.map((item) => {
                      const cardBin = item.project.bin_id ? binById.get(item.project.bin_id) : systemBin;
                      return (
                        <SortableProjectCard
                          key={item.id}
                          item={item}
                          viewMode={viewMode}
                          isSelected={expandedProjectId === item.project.id}
                          unreadCount={getUnreadCommentCount(item.project)}
                          onClick={() => handleCardClick(item.project)}
                          selectionMode={selectionMode}
                          isChecked={selectedIds.has(item.project.id)}
                          bin={cardBin}
                        />
                      );
                    })
                  )}
                </DroppableColumn>
              </SortableContext>
            </div>
          ))}
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeItem ? (
            <ProjectCard
              item={activeItem as DraggableProjectItem}
              viewMode={viewMode}
              isDragging
              bin={activeItem.project.bin_id ? binById.get(activeItem.project.bin_id) : systemBin}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ============================================================================
// Column Icon
// ============================================================================

function ColumnIcon({ viewMode, columnId }: { viewMode: ProjectViewMode; columnId: string }) {
  if (viewMode === 'status') {
    const status = columnId.replace('status:', '') as ProjectStatus;
    const marbleClass =
      status === 'not_started'
        ? styles.columnIconNotStarted
        : status === 'in_progress'
        ? styles.columnIconInProgress
        : status === 'paused'
        ? styles.columnIconPaused
        : styles.columnIconComplete;
    return <div className={cn(styles.columnIcon, marbleClass)} />;
  }

  return <div className={cn(styles.columnIcon, styles.columnIconDefault)} />;
}

// ============================================================================
// Droppable Column Wrapper
// ============================================================================

function DroppableColumn({ columnId, children }: { columnId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div ref={setNodeRef} className={cn(styles.columnContent, isOver && styles.columnOver)} data-kanban-content="true">
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
  selectionMode = false,
  isChecked = false,
  bin,
}: {
  item: DraggableProjectItem;
  viewMode: ProjectViewMode;
  isSelected: boolean;
  unreadCount: number;
  onClick: () => void;
  selectionMode?: boolean;
  isChecked?: boolean;
  bin?: ProjectBin;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: selectionMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: selectionMode ? 'pointer' : 'grab',
  };

  const handleClick = (_e: React.MouseEvent) => {
    if (isDragging) return;
    onClick();
  };

  // In selection mode we strip the drag listeners so clicks register cleanly
  // as toggles rather than drag starts.
  const dragProps = selectionMode ? {} : { ...attributes, ...listeners };

  return (
    <div ref={setNodeRef} style={style} {...dragProps} onClick={handleClick}>
      <ProjectCard
        item={item}
        viewMode={viewMode}
        isDragging={isDragging}
        isSelected={isSelected}
        unreadCount={unreadCount}
        selectionMode={selectionMode}
        isChecked={isChecked}
        bin={bin}
      />
    </div>
  );
}
