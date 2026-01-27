"use client";

import type { Announcements } from "@dnd-kit/core";
import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useMemo, useRef, useState } from "react";
import { getColumnName, getTargetColumnId, type KanbanItemProps, type KanbanColumnDataProps } from "../kanban-helpers";

function getItemGroupId<T extends KanbanItemProps>(item: T): string {
  return item.columnId;
}

function applyGroupChange<T extends KanbanItemProps>(item: T, groupId: string): T {
  return { ...item, columnId: groupId };
}

function getOverGroupId<T extends KanbanItemProps, C extends KanbanColumnDataProps>(
  overId: string,
  data: T[],
  columns: C[]
): string | null {
  const overItem = data.find((item) => item.id === overId);
  if (overItem) {
    return getItemGroupId(overItem);
  }

  const isOverColumn = columns.some((col) => col.id === overId);
  if (isOverColumn) {
    return overId;
  }

  return null;
}

function getCrossGroupInsertIndex<T extends KanbanItemProps, C extends KanbanColumnDataProps>(
  overId: string,
  data: T[],
  columns: C[],
  targetGroupId: string,
  activeIndex: number
): number {
  const isOverColumn = columns.some((col) => col.id === overId);

  if (isOverColumn) {
    const itemsInColumn = data.filter((item) => getItemGroupId(item) === targetGroupId);
    if (itemsInColumn.length > 0) {
      const lastItemInColumn = itemsInColumn[itemsInColumn.length - 1];
      const lastItemIndex = data.findIndex((item) => item.id === lastItemInColumn.id);
      if (activeIndex < lastItemIndex) {
        return lastItemIndex;
      }
      return lastItemIndex + 1;
    }
    return data.length;
  }

  const overIndex = data.findIndex((item) => item.id === overId);
  if (overIndex === -1) {
    return data.length;
  }

  if (activeIndex < overIndex) {
    return overIndex - 1;
  }
  return overIndex;
}

type UseKanbanDndOptions<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnDataProps = KanbanColumnDataProps,
> = {
  data: T[];
  columns: C[];
  enabled: boolean;
  onDataChange: (data: T[]) => void;
  onColumnChange?: (itemId: string, oldColumnId: string, newColumnId: string) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  canMoveToColumn?: (item: T, targetColumnId: string) => boolean;
};

export function useKanbanDnd<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnDataProps = KanbanColumnDataProps,
>({ data, columns, enabled, onDataChange, onColumnChange, onDragStart, onDragEnd, onDragOver, canMoveToColumn }: UseKanbanDndOptions<T, C>) {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const lastCrossGroupMoveRef = useRef<string | null>(null);
  const isUpdatingRef = useRef(false);
  const originalColumnRef = useRef<string | null>(null); // Track original column for persistence

  const activeItem = useMemo(() => data.find((item) => item.id === activeItemId) ?? null, [data, activeItemId]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeId = event.active.id as string;
      setActiveItemId(activeId);
      lastCrossGroupMoveRef.current = null;
      isUpdatingRef.current = false;
      // Store the original column when drag starts
      const item = data.find((i) => i.id === activeId);
      originalColumnRef.current = item ? getItemGroupId(item) : null;
      onDragStart?.(event);
    },
    [data, onDragStart]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (isUpdatingRef.current) {
        return;
      }

      const { over } = event;

      if (enabled && over) {
        const activeId = event.active.id as string;
        const overId = over.id as string;
        const draggedItem = data.find((item) => item.id === activeId);

        if (draggedItem) {
          const overGroupId = getOverGroupId(overId, data, columns);
          const draggedGroupId = getItemGroupId(draggedItem);

          if (overGroupId && draggedGroupId !== overGroupId) {
            // Check if move is allowed (e.g., prevent duplicates)
            if (canMoveToColumn && !canMoveToColumn(draggedItem, overGroupId)) {
              return; // Block the move
            }

            const moveKey = `${activeId}:${overGroupId}`;
            if (lastCrossGroupMoveRef.current === moveKey) {
              return;
            }
            lastCrossGroupMoveRef.current = moveKey;
            isUpdatingRef.current = true;

            const newData = [...data];
            const activeIndex = newData.findIndex((item) => item.id === activeId);
            const finalIndex = getCrossGroupInsertIndex(overId, data, columns, overGroupId, activeIndex);

            newData[activeIndex] = applyGroupChange(newData[activeIndex], overGroupId);

            onDataChange(arrayMove(newData, activeIndex, finalIndex));
            // Note: onColumnChange is called in handleDragEnd, not here
            // This allows dragging across multiple columns without intermediate persistence

            queueMicrotask(() => {
              isUpdatingRef.current = false;
            });
            return;
          }
        }
      }

      onDragOver?.(event);
    },
    [data, columns, enabled, onDataChange, onDragOver, canMoveToColumn]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      // Get the final column of the dragged item before resetting state
      const draggedItem = data.find((item) => item.id === active.id);
      const finalColumnId = draggedItem ? getItemGroupId(draggedItem) : null;
      const originalColumnId = originalColumnRef.current;

      // Reset state
      setActiveItemId(null);
      lastCrossGroupMoveRef.current = null;
      isUpdatingRef.current = false;
      originalColumnRef.current = null;

      // Notify about column change only if it actually changed (persistence happens here)
      if (originalColumnId && finalColumnId && originalColumnId !== finalColumnId) {
        onColumnChange?.(active.id as string, originalColumnId, finalColumnId);
      }

      onDragEnd?.(event);

      if (!over || active.id === over.id) {
        return;
      }

      const oldIndex = data.findIndex((item) => item.id === active.id);
      const newIndex = data.findIndex((item) => item.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      onDataChange(arrayMove(data, oldIndex, newIndex));
    },
    [data, onDataChange, onColumnChange, onDragEnd]
  );

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const item = data.find((i) => i.id === active.id);
        if (!item) {
          return "";
        }
        const columnName = getColumnName(item.columnId, columns);
        return `Picked up item "${(item as { title?: string }).title ?? item.id}" from the "${columnName}" column`;
      },
      onDragOver({ active, over }) {
        const item = data.find((i) => i.id === active.id);
        if (!(item && over)) {
          return "";
        }
        const targetColumnId = getTargetColumnId(over.id as string, data, columns);
        const columnName = getColumnName(targetColumnId ?? "", columns);
        return `Dragged item "${(item as { title?: string }).title ?? item.id}" over the "${columnName}" column`;
      },
      onDragEnd({ active, over }) {
        const item = data.find((i) => i.id === active.id);
        if (!(item && over)) {
          return "";
        }
        const targetColumnId = getTargetColumnId(over.id as string, data, columns);
        const columnName = getColumnName(targetColumnId ?? "", columns);
        return `Dropped item "${(item as { title?: string }).title ?? item.id}" into the "${columnName}" column`;
      },
      onDragCancel({ active }) {
        const item = data.find((i) => i.id === active.id);
        if (!item) {
          return "";
        }
        return `Cancelled dragging item "${(item as { title?: string }).title ?? item.id}"`;
      },
    }),
    [data, columns]
  );

  return {
    activeItem,
    sensors,
    announcements,
    handleDragStart: enabled ? handleDragStart : undefined,
    handleDragOver: enabled ? handleDragOver : undefined,
    handleDragEnd: enabled ? handleDragEnd : undefined,
  };
}
