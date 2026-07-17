'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConversationRow,
  ConversationCounts,
  ConversationTab,
} from '@/lib/conversations';
import type { DateRange } from '@/components/tasks/TaskFilterBar';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';

export type ConversationSort = 'newest' | 'oldest';

export interface MessagesFilters {
  direction: Set<string>;
  status: Set<string>;
  property: Set<string>;
  channel: Set<string>;
  checkIn: DateRange;
  checkOut: DateRange;
}

const emptyFilters = (): MessagesFilters => ({
  direction: new Set(),
  status: new Set(),
  property: new Set(),
  channel: new Set(),
  checkIn: { from: null, to: null },
  checkOut: { from: null, to: null },
});

interface MessagesContextValue {
  conversations: ConversationRow[]; // raw (current tab, server-sorted)
  visible: ConversationRow[]; // after search + filters
  counts: ConversationCounts;
  loading: boolean;
  reload: () => void;
  tab: ConversationTab;
  setTab: (t: ConversationTab) => void;
  sort: ConversationSort;
  toggleSort: () => void;
  query: string;
  setQuery: (q: string) => void;
  /** Whether the collapsible search field is revealed (the header shows only the
   *  search icon until toggled). Shared so the icon and the field — which live in
   *  different parts of the tree — stay in sync across desktop and mobile. */
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  filters: MessagesFilters;
  setFilter: <K extends keyof MessagesFilters>(key: K, value: MessagesFilters[K]) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

const EMPTY_CONVERSATIONS: ConversationRow[] = [];
const DEFAULT_COUNTS: ConversationCounts = { active: 0, complete: 0, unread: 0 };

function inRange(value: string | null, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!value) return false;
  const v = value.slice(0, 10);
  if (range.from && v < range.from) return false;
  if (range.to && v > range.to) return false;
  return true;
}

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<ConversationTab>('active');
  const [sort, setSort] = useState<ConversationSort>('newest');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<MessagesFilters>(emptyFilters);

  const queryClient = useQueryClient();
  // Server does the tab filtering + sorting, so both are part of the key.
  // keepPreviousData keeps the old list on screen across tab/sort switches
  // (matches the old load(), which never emptied the list mid-fetch).
  const listQuery = useQuery({
    queryKey: qk.conversations(tab, sort),
    queryFn: () =>
      fetchJson<{ conversations?: ConversationRow[]; counts?: ConversationCounts }>(
        `/api/messages?tab=${tab}&sort=${sort}`
      ),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const conversations = listQuery.data?.conversations ?? EMPTY_CONVERSATIONS;
  const counts = listQuery.data?.counts ?? DEFAULT_COUNTS;
  const loading = listQuery.isLoading;

  // Refresh every tab/sort combination — a mark-read or status change in one
  // thread affects the unread count on all tabs.
  const load = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [queryClient]);

  const setFilter = useCallback(
    <K extends keyof MessagesFilters>(key: K, value: MessagesFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );
  const clearFilters = useCallback(() => setFilters(emptyFilters()), []);
  const toggleSort = useCallback(
    () => setSort((s) => (s === 'newest' ? 'oldest' : 'newest')),
    [],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (q && !(c.guest_name ?? '').toLowerCase().includes(q)) return false;
      if (filters.direction.size && !(c.last_direction && filters.direction.has(c.last_direction)))
        return false;
      if (filters.status.size && !filters.status.has(c.reservation_status)) return false;
      if (filters.property.size && !(c.property_name && filters.property.has(c.property_name)))
        return false;
      if (filters.channel.size && !(c.channel && filters.channel.has(c.channel)))
        return false;
      if (!inRange(c.check_in, filters.checkIn)) return false;
      if (!inRange(c.check_out, filters.checkOut)) return false;
      return true;
    });
  }, [conversations, query, filters]);

  const activeFilterCount =
    (filters.direction.size ? 1 : 0) +
    (filters.status.size ? 1 : 0) +
    (filters.property.size ? 1 : 0) +
    (filters.channel.size ? 1 : 0) +
    (filters.checkIn.from || filters.checkIn.to ? 1 : 0) +
    (filters.checkOut.from || filters.checkOut.to ? 1 : 0);

  const value: MessagesContextValue = {
    conversations,
    visible,
    counts,
    loading,
    reload: load,
    tab,
    setTab,
    sort,
    toggleSort,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
  };

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error('useMessages must be used within MessagesProvider');
  return ctx;
}
