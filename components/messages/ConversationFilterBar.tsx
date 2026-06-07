'use client';

import { useMemo } from 'react';
import { ChipScrollLane } from '@/components/ui/chip-scroll-lane';
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
 * Filter row for the conversation list: reservation status, last-message
 * direction, property, channel, and check-in / check-out date ranges. Reuses the
 * TaskFilterBar primitives. Filtering is applied client-side in MessagesProvider.
 */
export function ConversationFilterBar() {
  const { conversations, filters, setFilter, activeFilterCount, clearFilters } =
    useMessages();

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

  return (
    <div className="shrink-0 px-2 pb-2">
      <ChipScrollLane>
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
      </ChipScrollLane>
      {activeFilterCount > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="mt-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
        >
          Clear filters ({activeFilterCount})
        </button>
      ) : null}
    </div>
  );
}
