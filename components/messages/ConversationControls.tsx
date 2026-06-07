'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Search, ArrowDown, ArrowUp, Filter as FilterIcon } from 'lucide-react';
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
 * One-row conversation list controls: search + sort arrow + filter funnel.
 * The filter pops out a DETACHED floating panel (portaled, wider than the
 * sidebar) with the filter pills laid out in a horizontal row. Stays open until
 * the funnel is toggled or Escape — so interacting with the pills' own portaled
 * dropdowns (z 9999, above this panel) doesn't dismiss it.
 */
export function ConversationControls() {
  const {
    query,
    setQuery,
    sort,
    toggleSort,
    conversations,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
  } = useMessages();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = btnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gutter = 8;
      const w = panelRef.current?.offsetWidth ?? 560;
      const maxLeft = window.innerWidth - w - gutter;
      const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, maxLeft));
      setPos({ left, top: rect.bottom + 6 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

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

  const filterActive = open || activeFilterCount > 0;

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guests"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[var(--accent-3)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
          />
        </div>

        <button
          type="button"
          onClick={toggleSort}
          title={sort === 'newest' ? 'Newest first' : 'Oldest first'}
          aria-label={`Sort: ${sort === 'newest' ? 'newest first' : 'oldest first'}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {sort === 'newest' ? (
            <ArrowDown className="h-4 w-4" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>

        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-pressed={open}
          title={open ? 'Hide filters' : 'Show filters'}
          className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
            filterActive
              ? 'bg-[var(--accent-bg-soft)] text-[var(--accent-3)] dark:bg-[var(--accent-bg-soft-dark)] dark:text-[var(--accent-1)]'
              : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          <FilterIcon className="h-4 w-4" />
          {activeFilterCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-3)] px-1 text-[10px] font-semibold text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </button>
      </div>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 50 }}
              className="w-[min(560px,calc(100vw-16px))] rounded-lg border border-[var(--surface-elevated-divider)] bg-[var(--surface-elevated)] p-3 shadow-xl"
            >
              <div className="flex flex-wrap items-center gap-2">
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
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Clear ({activeFilterCount})
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
