// Kanban drag-and-drop helper functions

export type KanbanItemProps = {
  id: string;
  columnId: string;
} & Record<string, unknown>;

export type KanbanColumnDataProps = {
  id: string;
  name: string;
} & Record<string, unknown>;

/**
 * Get the display name of a column by its ID
 */
export function getColumnName<C extends KanbanColumnDataProps>(
  columnId: string,
  columns: C[]
): string {
  const column = columns.find((col) => col.id === columnId);
  return column?.name ?? 'Unknown';
}

/**
 * Get the column ID that an item or column is associated with
 */
export function getTargetColumnId<T extends KanbanItemProps, C extends KanbanColumnDataProps>(
  overId: string,
  data: T[],
  columns: C[]
): string | null {
  // Check if overId is a column
  const column = columns.find((col) => col.id === overId);
  if (column) return column.id;

  // Check if overId is an item
  const item = data.find((i) => i.id === overId);
  if (item) return item.columnId;

  return null;
}
