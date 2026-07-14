'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Search, ArrowDown, ArrowUp, Filter as FilterIcon, X } from 'lucide-react';
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

const iconBtn =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors';
const iconBtnIdle =
  'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]';
const iconBtnActive =
  'bg-[var(--accent-bg-soft)] text-[var(--accent-3)] dark:bg-[var(--accent-bg-soft-dark)] dark:text-[var(--accent-1)]';

/**
 * Compact header cluster for the conversation list — a search toggle, the sort
 * direction arrow, and the filter funnel. Rendered inline with the "Messages"
 * label (desktop aside header / mobile top bar), NOT as its own row.
 *
 * Search collapses to just its icon; toggling it reveals ConversationSearchField
 * (a separate row below the header). Closing the search clears the query so no
 * invisible filter lingers. The filter funnel pops a DETACHED floating panel
 * (portaled, wider than the sidebar) with the filter pills in a horizontal row;
 * it stays open until the funnel is toggled or Escape.
 */
export function ConversationHeaderActions() {
  const {
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
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
  const searchActive = searchOpen || query.trim().length > 0;

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setQuery('');
    } else {
      setSearchOpen(true);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleSearch}
        aria-pressed={searchActive}
        title={searchOpen ? 'Hide search' : 'Search guests'}
        aria-label={searchOpen ? 'Hide search' : 'Search guests'}
        className={`${iconBtn} ${searchActive ? iconBtnActive : iconBtnIdle}`}
      >
        <Search className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={toggleSort}
        title={sort === 'newest' ? 'Newest first' : 'Oldest first'}
        aria-label={`Sort: ${sort === 'newest' ? 'newest first' : 'oldest first'}`}
        className={`${iconBtn} ${iconBtnIdle}`}
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
        className={`${iconBtn} relative ${filterActive ? iconBtnActive : iconBtnIdle}`}
      >
        <FilterIcon className="h-4 w-4" />
        {activeFilterCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-3)] px-1 text-[10px] font-semibold text-white">
            {activeFilterCount}
          </span>
        ) : null}
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 50 }}
              className="liquid-glass-surface w-[min(560px,calc(100vw-16px))] rounded-xl border border-[var(--surface-elevated-line)] p-3 shadow-xl"
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

/**
 * The collapsible search input, revealed as its own row beneath the header when
 * the search icon in ConversationHeaderActions is toggled on. Autofocuses on
 * open; Escape or the clear button closes it (and clears the query).
 */
export function ConversationSearchField() {
  const { query, setQuery, searchOpen, setSearchOpen } = useMessages();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  if (!searchOpen) return null;

  const close = () => {
    setSearchOpen(false);
    setQuery('');
  };

  return (
    <div className="msg-in shrink-0 px-3 pb-2 pt-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          placeholder="Search guests"
          className="msg-well w-full rounded-lg py-1.5 pl-8 pr-8 text-sm text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-[var(--accent-3)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] dark:focus:ring-[var(--accent-ring-dark)]"
        />
        <button
          type="button"
          onClick={close}
          aria-label="Close search"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
