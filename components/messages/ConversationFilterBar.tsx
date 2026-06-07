'use client';

import { useMemo, useState } from 'react';
import { Filter as FilterIcon } from 'lucide-react';
import {
  MultiSelect,
  DateRangeChip,
  type FilterOption,
} from '@/components/tasks/TaskFilterBar';
import { canonicalChannelLabel } from '@/lib/bookingChannel';
import { useMessages } from '@/components/messages/MessagesProvider';

const STATUS_OPTIONS: FilterOption[] = [
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'current', label: 'Current' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DIRECTION_OPTIONS: FilterOption[] = [
  { value: 'inbound', label: 'Guest (inbound)' },
  { value: 'outbound', label: 'You (outbound)' },
];

/**
 * A filter funnel icon (matching the workspace header convention). Clicking it
 * pops out a panel with the filter dropdowns stacked vertically. Filtering is
 * applied client-side in MessagesProvider.
 */
export function ConversationFilterBar() {
  const { conversations, filters, setFilter, activeFilterCount, clearFilters } =
    useMessages();
  const [open, setOpen] = useState(false);

  const propertyOptions = useMemo<FilterOption[]>(() => {
    const names = new Set<string>();
    for (const c of conversations) if (c.property_name) names.add(c.property_name);
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [conversations]);

  const channelOptions = useMemo<FilterOption[]>(() => {
    const keys = new Set<string>();
    for (const c of conversations) if (c.channel) keys.add(c.channel);
    return [...keys].sort().map((k) => ({ value: k, label: canonicalChannelLabel(k) }));
  }, [conversations]);

  const active = open || activeFilterCount > 0;

  return (
    <div className="shrink-0 px-3 pb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        title={open ? 'Hide filters' : 'Show filters'}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${
          active
            ? 'bg-[var(--accent-bg-soft)] text-[var(--accent-3)] dark:bg-[var(--accent-bg-soft-dark)] dark:text-[var(--accent-1)]'
            : 'border border-[var(--surface-elevated-divider)] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white'
        }`}
      >
        <FilterIcon className="h-4 w-4" />
        {activeFilterCount > 0 ? (
          <span className="rounded-full bg-[var(--accent-3)] px-1.5 text-[10px] font-semibold text-white">
            {activeFilterCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-2 flex flex-col items-start gap-2 rounded-md border border-[var(--surface-elevated-divider)] p-2">
          <MultiSelect
            label="Status"
            options={STATUS_OPTIONS}
            selected={filters.status}
            onChange={(s) => setFilter('status', s)}
          />
          <MultiSelect
            label="Direction"
            options={DIRECTION_OPTIONS}
            selected={filters.direction}
            onChange={(s) => setFilter('direction', s)}
          />
          <MultiSelect
            label="Property"
            options={propertyOptions}
            selected={filters.property}
            onChange={(s) => setFilter('property', s)}
            searchable
          />
          <MultiSelect
            label="Channel"
            options={channelOptions}
            selected={filters.channel}
            onChange={(s) => setFilter('channel', s)}
          />
          <DateRangeChip
            label="Check-in"
            range={filters.checkIn}
            onChange={(r) => setFilter('checkIn', r)}
          />
          <DateRangeChip
            label="Check-out"
            range={filters.checkOut}
            onChange={(r) => setFilter('checkOut', r)}
          />
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
            >
              Clear filters ({activeFilterCount})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
