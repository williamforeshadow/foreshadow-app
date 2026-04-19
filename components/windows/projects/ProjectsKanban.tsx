'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import type { Project, ProjectStatus, ProjectPriority, PropertyOption, User, Department, ProjectBin } from '@/lib/types';
import type { ProjectViewMode } from '@/lib/types';
import { STATUS_LABELS, PRIORITY_LABELS, STATUS_ORDER, PRIORITY_ORDER } from '@/lib/types';
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
  showTexture?: boolean;
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
  showTexture = true,
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
          {showTexture && (
            <div
              className={styles.boardTexture}
              style={{ backgroundImage: "url('/images/kanban-bg-doodles.png')" }}
            />
          )}
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
            <ProjectCardContent
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
      <ProjectCardContent
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

// ============================================================================
// Card Content (used in both sortable cards and drag overlay)
// ============================================================================

// Minute-level ticker so countdown badges update live without reading
// Date.now() on every render / re-mount of a card.
function useMinuteTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 60_000);
    return () => clearInterval(id);
  }, [enabled]);
}

function formatAutoDismissLabel(completedAt: string, days: number): { text: string } | null {
  const completedMs = new Date(completedAt).getTime();
  if (!Number.isFinite(completedMs)) return null;
  const deadlineMs = completedMs + days * 24 * 60 * 60 * 1000;
  const remainingMs = deadlineMs - Date.now();
  // Past deadline: hide entirely. The hourly sweep will remove the task from
  // the bin server-side; the UI just goes quiet in the meantime.
  if (remainingMs <= 0) return null;
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const d = Math.floor(totalMinutes / (60 * 24));
  const h = Math.floor((totalMinutes % (60 * 24)) / 60);
  const m = totalMinutes % 60;
  if (d >= 1) return { text: `dismissing in ${d}d ${h}h` };
  if (h >= 1) return { text: `dismissing in ${h}h ${m}m` };
  return { text: `dismissing in ${m}m` };
}

function ProjectCardContent({
  item,
  viewMode,
  isDragging = false,
  isSelected = false,
  unreadCount = 0,
  selectionMode = false,
  isChecked = false,
  bin,
}: {
  item: DraggableProjectItem;
  viewMode: ProjectViewMode;
  isDragging?: boolean;
  isSelected?: boolean;
  unreadCount?: number;
  selectionMode?: boolean;
  isChecked?: boolean;
  bin?: ProjectBin;
}) {
  const project = item.project;
  const { departments: allDepts } = useDepartments();
  const dept = allDepts.find(d => d.id === project.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);

  // Auto-dismiss countdown — only relevant for completed binned tasks whose
  // bin has auto-dismiss enabled.
  const autoDismissActive =
    project.status === 'complete' &&
    !!project.is_binned &&
    !!project.completed_at &&
    !!bin?.auto_dismiss_enabled;
  useMinuteTick(autoDismissActive);
  const autoDismiss = autoDismissActive
    ? formatAutoDismissLabel(project.completed_at as string, bin?.auto_dismiss_days ?? 7)
    : null;

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
      case 'paused':
        return styles.statusPaused;
      default:
        return styles.statusNotStarted;
    }
  };

  const getCardStatusClass = (status: string | undefined) => {
    switch (status) {
      case 'complete':
        return styles.cardStatusComplete;
      case 'in_progress':
        return styles.cardStatusInProgress;
      case 'paused':
        return styles.cardStatusPaused;
      default:
        return styles.cardStatusNotStarted;
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
      className={cn(
        styles.card,
        getCardStatusClass(project.status),
        project.status === 'complete' && styles.cardDimmed,
        isDragging && styles.cardDragging,
        selectionMode && styles.cardSelectable,
        selectionMode && isChecked && styles.cardChecked,
      )}
      style={isSelected && !selectionMode ? { boxShadow: '0 0 0 1.5px currentColor', opacity: 1 } : undefined}
    >
      {/* Unread badge — hidden during selection mode to keep the card clean */}
      {unreadCount > 0 && !isSelected && !selectionMode && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#d97757',
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

      {/* Card Header — title · dept icon. In selection mode, the selected
          state is expressed purely through a background tone on the card,
          not a checkbox, to keep the card minimal. */}
      <div className={styles.cardHeader}>
        <div className={styles.cardContent}>
          <p className={styles.cardTitle}>{project.title}</p>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
        <div className={styles.cardIcon}>
          <DeptIcon className="w-3 h-3" />
        </div>
      </div>

      {/* Card Footer */}
      <div className={styles.cardFooter}>
        {/* Left: status + priority + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem', flexWrap: 'wrap' }}>
          <span className={cn(styles.statusBadge, getStatusClass(project.status))}>
            {project.status?.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
          </span>
          {viewMode !== 'priority' && (
            <span className={cn(styles.priorityBadge, getPriorityClass(project.priority))}>
              {project.priority?.replace(/^\w/, c => c.toUpperCase())}
            </span>
          )}
          {project.scheduled_time && (() => {
            const [h, m] = project.scheduled_time!.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return (
              <span style={{ fontSize: '0.6625rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'rgba(30, 25, 20, 0.35)' }} className="dark:!text-[#66645f]">
                {h12}:{String(m).padStart(2, '0')} {ampm}
              </span>
            );
          })()}
        </div>

        {/* Right: assignee avatars */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {viewMode !== 'assignee' && assignees.length > 0 && (
            <>
              {assignees.slice(0, 3).map((user, index) => (
                <div
                  key={user.id}
                  className="bg-neutral-200 dark:bg-neutral-700 ring-2 ring-white dark:ring-[#131315]"
                  style={{
                    width: 21,
                    height: 21,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.53125rem',
                    fontWeight: 600,
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
                    <span className="text-neutral-500 dark:text-[#a09e9a]">
                      {user.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
              {assignees.length > 3 && (
                <div
                  className="bg-neutral-300 dark:bg-neutral-600 ring-2 ring-white dark:ring-[#131315] text-neutral-500 dark:text-[#a09e9a]"
                  style={{
                    width: 21,
                    height: 21,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.53125rem',
                    fontWeight: 600,
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

      {/* Auto-dismiss countdown — only shown on completed binned cards when
          the containing bin has auto-dismiss enabled and the deadline hasn't
          yet passed. */}
      {autoDismiss && (
        <div
          className={styles.autoDismissRow}
          title="This task will be automatically removed from its bin"
        >
          <svg className={styles.autoDismissIcon} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={styles.autoDismissLabel}>{autoDismiss.text}</span>
        </div>
      )}

      {/* Template row — signals that status is checklist-driven.
          Only shown for templated tasks. */}
      {project.template_id && project.template_name && (
        <div className={styles.templateRow} title="Status is controlled by this task's checklist">
          <svg className={styles.templateIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className={styles.templateName}>{project.template_name}</span>
        </div>
      )}
    </div>
  );
}
