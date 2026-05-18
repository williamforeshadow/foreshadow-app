'use client';

// Timeline Day Kanban — task-native fork of the Bins Kanban (ProjectsKanban).
//
// Scope: one column per user (+ an "Unassigned" column), showing the tasks
// scheduled for `date`. Dragging a card between columns reassigns the task.
// This is a deliberate fork: it starts visually identical to the Bins board
// but is Timeline-owned and may diverge without touching the Bins page.

import { useMemo, useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/user-avatar';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { ColumnPicker } from '@/components/windows/projects/ColumnPicker';
import type { Task } from '@/lib/types';
import styles from './DayKanban.module.css';

// DnD Kit
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
import type { KanbanItemProps, KanbanColumnDataProps } from '@/lib/kanban-helpers';

type DayTask = Task & { property_name: string };

/** Only the fields the board needs — accepts both AppUser and User shapes. */
type ColumnUser = { id: string; name: string; avatar?: string };

interface DayKanbanProps {
  date: Date;
  tasks: DayTask[];
  users: ColumnUser[];
  openTaskId: string | null;
  onClose: () => void;
  onTaskClick: (task: Task, propertyName: string) => void;
  /** Persist a task's full assignee list (empty = unassigned). */
  onAssignChange: (taskId: string, userIds: string[]) => void;
  isFullScreen?: boolean;
}

const UNASSIGNED = 'unassigned';

interface DraggableTaskItem extends KanbanItemProps {
  id: string;
  columnId: string;
  data: DayTask;
  originalItemId: string;
}

interface KanbanColumn extends KanbanColumnDataProps {
  id: string;
  name: string;
  avatar?: string;
  isUnassigned?: boolean;
}

const formatDateHeader = (date: Date) =>
  date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function DayKanban({
  date,
  tasks,
  users,
  openTaskId,
  onClose,
  onTaskClick,
  onAssignChange,
  isFullScreen = false,
}: DayKanbanProps) {
  // Local YMD (not UTC) so day filtering doesn't shift across timezones.
  const kanbanDateStr = useMemo(() => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [date]);

  const dayTasks = useMemo(
    () => tasks.filter((t) => t.scheduled_date === kanbanDateStr),
    [tasks, kanbanDateStr],
  );

  // Unassigned first, then every user (seeded from the prop so empty columns
  // still render — matches the Bins assignee view).
  const allColumns: KanbanColumn[] = useMemo(() => {
    const userCols = [...users]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ id: u.id, name: u.name, avatar: u.avatar }));
    return [
      { id: UNASSIGNED, name: 'Unassigned', isUnassigned: true },
      ...userCols,
    ];
  }, [users]);

  // Column visibility — same picker + persistence as the Bins board. A
  // dedicated key (binId='timeline', viewMode='assignee') keeps the choice
  // stable across day navigation and isolated from the Bins keys.
  const colVis = useColumnVisibility('timeline', 'assignee');
  const allColumnIds = useMemo(() => allColumns.map((c) => c.id), [allColumns]);
  useEffect(() => {
    if (colVis.initialized) colVis.initWithDefaults(allColumnIds);
  }, [colVis.initialized, allColumnIds, colVis]);

  const columns: KanbanColumn[] = useMemo(
    () => allColumns.filter((c) => colVis.visibleIds.has(c.id)),
    [allColumns, colVis.visibleIds],
  );

  const columnPicker = (
    <ColumnPicker
      columns={allColumns.map((c) => ({ id: c.id, name: c.name }))}
      visibleColumnIds={colVis.visibleIds}
      onToggle={colVis.toggle}
      onSelectAll={() => colVis.selectAll(allColumnIds)}
      onClearAll={colVis.clearAll}
    />
  );

  const initialItems = useMemo(() => {
    const items: DraggableTaskItem[] = [];
    dayTasks.forEach((task) => {
      const assignees = task.assigned_users ?? [];
      if (assignees.length > 0) {
        const seen = new Set<string>();
        assignees.forEach((a) => {
          if (seen.has(a.user_id)) return;
          seen.add(a.user_id);
          items.push({
            id: `task-${task.task_id}-${a.user_id}`,
            columnId: a.user_id,
            data: task,
            originalItemId: task.task_id,
          });
        });
      } else {
        items.push({
          id: `task-${task.task_id}-${UNASSIGNED}`,
          columnId: UNASSIGNED,
          data: task,
          originalItemId: task.task_id,
        });
      }
    });
    return items;
  }, [dayTasks]);

  const [items, setItems] = useState<DraggableTaskItem[]>(initialItems);
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const handleColumnChange = useCallback(
    (itemId: string, oldColumnId: string, newColumnId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      const currentIds = (item.data.assigned_users ?? []).map((u) => u.user_id);

      // Remove the user whose column the card was dragged from (if any).
      let nextIds = currentIds.filter((id) => id !== oldColumnId);
      // Add the target user unless dropping into Unassigned.
      if (newColumnId !== UNASSIGNED && !nextIds.includes(newColumnId)) {
        nextIds = [...nextIds, newColumnId];
      }

      onAssignChange(item.originalItemId, nextIds);
    },
    [items, onAssignChange],
  );

  // Block a drop that would show the same task twice in one column.
  const canMoveToColumn = useCallback(
    (item: DraggableTaskItem, targetColumnId: string) => {
      return !items.some(
        (i) =>
          i.columnId === targetColumnId &&
          i.originalItemId === item.originalItemId &&
          i.id !== item.id,
      );
    },
    [items],
  );

  const { activeItem, sensors, announcements, handleDragStart, handleDragOver, handleDragEnd } =
    useKanbanDnd<DraggableTaskItem, KanbanColumn>({
      data: items,
      columns,
      enabled: true,
      onDataChange: setItems,
      onColumnChange: handleColumnChange,
      canMoveToColumn,
    });

  const itemsByColumn = useMemo(() => {
    const grouped: Record<string, DraggableTaskItem[]> = {};
    columns.forEach((col) => {
      grouped[col.id] = items.filter((i) => i.columnId === col.id);
    });
    return grouped;
  }, [items, columns]);

  const totalItems = dayTasks.length;

  const board = (
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
          <div key={column.id} className={styles.column} data-kanban-column="true">
            <div className={styles.columnHeader}>
              {column.isUnassigned ? (
                <div className={cn(styles.columnIcon, styles.columnIconDefault)} />
              ) : (
                <UserAvatar src={column.avatar} name={column.name} size="sm" />
              )}
              <div className={styles.columnHeaderInfo}>
                <p className={styles.columnTitle}>{column.name}</p>
              </div>
              <span className={styles.columnCount}>
                {itemsByColumn[column.id]?.length || 0}
              </span>
            </div>

            <SortableContext
              items={itemsByColumn[column.id]?.map((i) => i.id) || []}
              strategy={verticalListSortingStrategy}
            >
              <DroppableColumn columnId={column.id}>
                {itemsByColumn[column.id]?.length === 0 ? (
                  <div className={styles.emptyColumn}>No tasks</div>
                ) : (
                  itemsByColumn[column.id]?.map((item) => (
                    <SortableTaskCard
                      key={item.id}
                      item={item}
                      isSelected={openTaskId === item.originalItemId}
                      onClick={() => onTaskClick(item.data, item.data.property_name)}
                    />
                  ))
                )}
              </DroppableColumn>
            </SortableContext>
          </div>
        ))}
      </div>

      <DragOverlay>
        {activeItem ? <TaskCardContent item={activeItem} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );

  if (isFullScreen) {
    return (
      <div className={styles.containerFullScreen}>
        <div className={styles.headerFullScreen}>
          <div className={styles.headerContent}>
            <h2 className={styles.headerTitle}>{formatDateHeader(date)}</h2>
            <p className={styles.headerSubtitle}>
              {totalItems} task{totalItems !== 1 ? 's' : ''} scheduled
            </p>
          </div>
          {columnPicker}
        </div>
        {board}
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <h2 className={styles.headerTitle}>{formatDateHeader(date)}</h2>
            <p className={styles.headerSubtitle}>
              {totalItems} task{totalItems !== 1 ? 's' : ''} scheduled
            </p>
          </div>
          <div className="flex items-center gap-2">
            {columnPicker}
            <Button variant="ghost" size="icon" className={styles.closeButton} onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        {board}
      </div>
    </div>
  );
}

function DroppableColumn({
  columnId,
  children,
}: {
  columnId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  return (
    <div ref={setNodeRef} className={cn(styles.columnContent, isOver && styles.columnOver)}>
      {children}
    </div>
  );
}

function SortableTaskCard({
  item,
  isSelected,
  onClick,
}: {
  item: DraggableTaskItem;
  isSelected: boolean;
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

  const handleClick = () => {
    if (isDragging) return;
    onClick();
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={handleClick}>
      <TaskCardContent item={item} isDragging={isDragging} isSelected={isSelected} />
    </div>
  );
}

function statusBadgeClass(status: string | undefined) {
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
}

function cardStatusClass(status: string | undefined) {
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
}

function priorityClass(priority: string | undefined) {
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
}

function TaskCardContent({
  item,
  isDragging = false,
  isSelected = false,
}: {
  item: DraggableTaskItem;
  isDragging?: boolean;
  isSelected?: boolean;
}) {
  const task = item.data;
  const { departments: allDepts } = useDepartments();
  const dept = allDepts.find((d) => d.id === task.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);

  const title = task.title || task.template_name || 'Task';

  return (
    <div
      className={cn(
        styles.card,
        cardStatusClass(task.status),
        task.status === 'complete' && styles.cardDimmed,
        isDragging && styles.cardDragging,
      )}
      style={isSelected ? { boxShadow: '0 0 0 1.5px currentColor', opacity: 1 } : undefined}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardContent}>
          <p className={styles.cardTitle}>{title}</p>
          {task.property_name && <p className={styles.cardSubtitle}>{task.property_name}</p>}
        </div>
        <div className={styles.cardIcon}>
          <DeptIcon className="w-3 h-3" />
        </div>
      </div>

      <div className={styles.cardFooter}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem', flexWrap: 'wrap' }}>
          <span className={cn(styles.statusBadge, statusBadgeClass(task.status))}>
            {task.status?.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
          </span>
          {task.priority && (
            <span className={cn(styles.priorityBadge, priorityClass(task.priority))}>
              {task.priority.replace(/^\w/, (c) => c.toUpperCase())}
            </span>
          )}
          {task.scheduled_time &&
            (() => {
              const [h, m] = task.scheduled_time!.split(':').map(Number);
              const ampm = h >= 12 ? 'PM' : 'AM';
              const h12 = h % 12 || 12;
              return (
                <span
                  style={{
                    fontSize: '0.6625rem',
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'rgba(30, 25, 20, 0.35)',
                  }}
                  className="dark:!text-[#66645f]"
                >
                  {h12}:{String(m).padStart(2, '0')} {ampm}
                </span>
              );
            })()}
        </div>
      </div>

      {task.template_id && task.template_name && (
        <div className={styles.templateRow} title="Status is controlled by this task's checklist">
          <svg className={styles.templateIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            />
          </svg>
          <span className={styles.templateName}>{task.template_name}</span>
        </div>
      )}
    </div>
  );
}
