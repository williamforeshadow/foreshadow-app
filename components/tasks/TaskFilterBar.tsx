// Shared filter/sort TYPES for the task-ledger surfaces. The chip-lane UI
// that used to live here (TaskFilterBar, MultiSelect, DateRangeChip,
// SortSelect) is fully replaced by the standard pickers in
// components/tasks/TaskPickers.tsx — every surface now renders the drill-in
// FilterPicker / SortPicker (drawer on mobile, matching popover on desktop).
// Only the data shapes remain, since every consumer still speaks them.

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /**
   * Optional section heading. When two consecutive options have different
   * `group` values (or one is undefined), the picker's option list renders a
   * small uppercase section header above the second one. Use this to break
   * long lists into semantic sections (e.g. "Sub-Bins" vs the unsectioned
   * "Task Bin" / "Not binned" entries at the top).
   *
   * Options are rendered in the order they appear in the `options` array;
   * group together options that share a `group` value.
   */
  group?: string;
}

// Origin filter values. Empty set OR both selected = no filter at the
// consumer's filter layer.
export const ORIGIN_MANUAL = 'manual';
export const ORIGIN_AUTOMATED = 'automated';

export type SortKey =
  | 'scheduled'
  | 'completed'
  | 'created'
  | 'updated'
  | 'priority';
export type SortDir = 'asc' | 'desc';

export interface DateRange {
  from: string | null;
  to: string | null;
}
