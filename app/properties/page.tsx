'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface PropertyRow {
  id: string;
  name: string;
  hostaway_name: string | null;
  hostaway_listing_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PropertyGroup {
  key: string;
  label: string;
  sublabel: string;
  items: PropertyRow[];
  dimmed?: boolean;
  defaultCollapsed?: boolean;
}

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(['inactive'])
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/properties?include_inactive=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch properties');
      setProperties(data.properties || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch properties');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const { groups, activeCount, inactiveCount, linkedCount, unlinkedCount } = useMemo(() => {
    const linkedActive: PropertyRow[] = [];
    const unlinkedActive: PropertyRow[] = [];
    const inactive: PropertyRow[] = [];

    for (const p of properties) {
      if (!p.is_active) {
        inactive.push(p);
      } else if (p.hostaway_listing_id != null) {
        linkedActive.push(p);
      } else {
        unlinkedActive.push(p);
      }
    }
    linkedActive.sort((a, b) => a.name.localeCompare(b.name));
    unlinkedActive.sort((a, b) => a.name.localeCompare(b.name));
    inactive.sort((a, b) => a.name.localeCompare(b.name));

    const result: PropertyGroup[] = [];
    if (linkedActive.length > 0) {
      result.push({
        key: 'linked',
        label: 'Linked to Hostaway',
        sublabel: `${linkedActive.length}`,
        items: linkedActive,
      });
    }
    if (unlinkedActive.length > 0) {
      result.push({
        key: 'unlinked',
        label: 'Unlinked',
        sublabel: `${unlinkedActive.length}`,
        items: unlinkedActive,
      });
    }
    if (inactive.length > 0) {
      result.push({
        key: 'inactive',
        label: 'Inactive',
        sublabel: `${inactive.length}`,
        items: inactive,
        dimmed: true,
        defaultCollapsed: true,
      });
    }
    return {
      groups: result,
      activeCount: linkedActive.length + unlinkedActive.length,
      inactiveCount: inactive.length,
      linkedCount: linkedActive.length,
      unlinkedCount: unlinkedActive.length,
    };
  }, [properties]);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCreated = (newProperty: PropertyRow) => {
    setShowAddModal(false);
    // Navigate straight into the profile — matches the decision that
    // creation flows open the new property immediately.
    router.push(`/properties/${newProperty.id}`);
  };

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setToast({ kind, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/hostaway/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `Sync failed (${res.status})`);
      }

      // Build a compact summary. Under the explicit-import model the sync
      // no longer auto-creates properties, so we surface only updated
      // counts and reservation activity. `properties_skipped_unlinked`
      // would confuse more than it helps for a first-look toast, so we
      // omit it here.
      const parts: string[] = [];
      const propUpdated = data.properties_updated ?? 0;
      const resInserted = data.reservations_inserted ?? 0;
      const resUpdated = data.reservations_updated ?? 0;
      const resRemoved = data.reservations_removed ?? 0;

      if (propUpdated) parts.push(`${propUpdated} updated`);
      if (resInserted) parts.push(`${resInserted} new ${resInserted === 1 ? 'reservation' : 'reservations'}`);
      if (resUpdated) parts.push(`${resUpdated} res. updated`);
      if (resRemoved) parts.push(`${resRemoved} cancelled`);

      const summary = parts.length > 0 ? parts.join(' · ') : 'Already up to date';
      showToast('success', `Hostaway synced — ${summary}`);
      await fetchProperties();
    } catch (err: any) {
      showToast('error', err.message || 'Hostaway sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-full flex flex-col min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 px-5 sm:px-8 pt-3 sm:pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
                Properties
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium flex-wrap">
                <span>{activeCount} active</span>
                {linkedCount > 0 && (
                  <>
                    <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                    <span>{linkedCount} linked</span>
                  </>
                )}
                {unlinkedCount > 0 && (
                  <>
                    <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                    <span>{unlinkedCount} unlinked</span>
                  </>
                )}
                {inactiveCount > 0 && (
                  <>
                    <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                    <span>{inactiveCount} inactive</span>
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                onClick={handleSync}
                disabled={syncing}
                title="Pull latest listings and reservations from Hostaway"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors disabled:opacity-50"
              >
                {syncing ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 006.5 6.5M4 15a8 8 0 0013.5 2.5" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 006.5 6.5M4 15a8 8 0 0013.5 2.5" />
                  </svg>
                )}
                <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync Hostaway'}</span>
                <span className="sm:hidden">{syncing ? 'Syncing' : 'Sync'}</span>
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] rounded-md hover:bg-neutral-800 dark:hover:bg-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Property</span>
                <span className="sm:hidden">Add</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">{error}</p>
            </div>
          ) : properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No properties yet</p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
                Add one from Hostaway or create it manually to get started
              </p>
            </div>
          ) : (
            <div className="px-5 sm:px-8 pb-8">
              {groups.map((group) => {
                const isCollapsed = collapsedSections.has(group.key);
                return (
                  <div key={group.key} className="pt-5">
                    <button
                      onClick={() => toggleSection(group.key)}
                      className="flex items-center justify-between w-full mb-3"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        <span className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
                          {group.label}
                        </span>
                      </div>
                      <span className="text-[11px] text-neutral-400 dark:text-[#66645f] tracking-[0.05em] tabular-nums uppercase">
                        {group.sublabel}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div className="flex flex-col">
                        {group.items.map((item, idx) => {
                          const showHostawayName =
                            item.hostaway_name && item.hostaway_name !== item.name;
                          const dim = group.dimmed;
                          const isLinked = item.hostaway_listing_id != null;
                          return (
                            <Link
                              key={item.id}
                              href={`/properties/${item.id}`}
                              className={`block relative py-3.5 px-3 -mx-3 rounded-lg transition-colors hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)] ${
                                idx < group.items.length - 1
                                  ? 'border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)]'
                                  : ''
                              } ${dim ? 'opacity-60' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <div className="text-[14px] font-medium text-neutral-800 dark:text-[#f0efed] leading-snug tracking-tight mb-0.5 truncate">
                                    {item.name}
                                  </div>
                                  {showHostawayName && (
                                    <div className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug truncate">
                                      Hostaway: {item.hostaway_name}
                                    </div>
                                  )}
                                </div>
                                <div className="shrink-0 text-right">
                                  {isLinked ? (
                                    <div className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] tabular-nums tracking-[0.04em] uppercase whitespace-nowrap">
                                      ID · {item.hostaway_listing_id}
                                    </div>
                                  ) : (
                                    <div
                                      className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] tracking-[0.04em] uppercase whitespace-nowrap"
                                      title="Not linked to a Hostaway listing. Open the property to link it."
                                    >
                                      Not linked
                                    </div>
                                  )}
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddPropertyModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleCreated}
          existingNames={properties.map((p) => p.name)}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw]"
        >
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis border ${
              toast.kind === 'success'
                ? 'bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] border-neutral-800 dark:border-neutral-300'
                : 'bg-red-600 text-white border-red-700'
            }`}
          >
            {toast.kind === 'success' ? (
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            )}
            <span className="truncate">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Add Property modal (tabbed: From Hostaway | Manual) ---

interface AvailableListing {
  hostaway_listing_id: number;
  name: string;
  already_linked: boolean;
}

type AddTab = 'hostaway' | 'manual';

function AddPropertyModal({
  onClose,
  onCreated,
  existingNames,
}: {
  onClose: () => void;
  onCreated: (p: PropertyRow) => void;
  existingNames: string[];
}) {
  const [tab, setTab] = useState<AddTab>('hostaway');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Hostaway tab state ---
  const [listings, setListings] = useState<AvailableListing[] | null>(null);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [listingQuery, setListingQuery] = useState('');

  // --- Manual tab state ---
  const [manualName, setManualName] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Lazy-load available listings on entering the hostaway tab.
  useEffect(() => {
    if (tab !== 'hostaway' || listings !== null || listingsLoading) return;
    let cancelled = false;
    setListingsLoading(true);
    setListingsError(null);
    fetch('/api/hostaway/listings?available=true')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load Hostaway listings');
        if (!cancelled) setListings((data.listings || []) as AvailableListing[]);
      })
      .catch((err) => {
        if (!cancelled) setListingsError(err.message || 'Failed to load Hostaway listings');
      })
      .finally(() => {
        if (!cancelled) setListingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, listings, listingsLoading]);

  useEffect(() => {
    if (tab === 'manual') manualInputRef.current?.focus();
  }, [tab]);

  // Reset inline error when the user switches tabs — stale messages would
  // otherwise bleed across tabs.
  useEffect(() => {
    setError(null);
  }, [tab]);

  const filteredListings = useMemo(() => {
    if (!listings) return [];
    const q = listingQuery.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        String(l.hostaway_listing_id).includes(q)
    );
  }, [listings, listingQuery]);

  const nameCollision = (candidate: string) => {
    const n = candidate.trim().toLowerCase();
    return existingNames.some((x) => x.trim().toLowerCase() === n);
  };

  const importFromHostaway = async (listing: AvailableListing) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostaway_listing_id: listing.hostaway_listing_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import from Hostaway');
      onCreated(data.property);
    } catch (err: any) {
      setError(err.message || 'Failed to import from Hostaway');
      setSubmitting(false);
    }
  };

  const createManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualName.trim();
    if (!trimmed) {
      setError('Please enter a property name');
      return;
    }
    if (nameCollision(trimmed)) {
      setError(`A property named "${trimmed}" already exists`);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create property');
      onCreated(data.property);
    } catch (err: any) {
      setError(err.message || 'Failed to create property');
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-label="Add Property"
      >
        <div className="w-full max-w-[520px] bg-white dark:bg-[#0b0b0c] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] rounded-lg shadow-2xl pointer-events-auto flex flex-col max-h-[80vh]">
          <div className="px-5 pt-5 pb-0">
            <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-[#f0efed] tracking-tight">
              Add Property
            </h2>
            <p className="text-[12px] text-neutral-500 dark:text-[#66645f] mt-1">
              Import a listing from Hostaway, or create a property manually.
            </p>

            <div className="mt-4 flex items-center gap-1 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] -mx-5 px-5">
              {(
                [
                  { id: 'hostaway' as AddTab, label: 'From Hostaway' },
                  { id: 'manual' as AddTab, label: 'Manual' },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-2 text-[13px] font-medium -mb-px border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-neutral-900 dark:border-[#f0efed] text-neutral-900 dark:text-[#f0efed]'
                      : 'border-transparent text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#a09e9a]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'hostaway' ? (
            <>
              <div className="px-5 pt-3 pb-2">
                <div className="relative">
                  <svg
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 dark:text-[#66645f] pointer-events-none"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10A7 7 0 113 10a7 7 0 0114 0z" />
                  </svg>
                  <input
                    value={listingQuery}
                    onChange={(e) => setListingQuery(e.target.value)}
                    placeholder="Search available Hostaway listings…"
                    className="w-full pl-8 pr-3 py-2 text-[13px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors"
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto px-5 pb-2 min-h-[160px]">
                {listingsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : listingsError ? (
                  <div className="py-4 text-[13px] text-red-600 dark:text-red-400">
                    {listingsError}
                  </div>
                ) : filteredListings.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-[13px] text-neutral-600 dark:text-[#a09e9a]">
                      {listings && listings.length === 0
                        ? 'No available Hostaway listings.'
                        : 'No matches.'}
                    </p>
                    {listings && listings.length === 0 && (
                      <p className="text-[12px] text-neutral-500 dark:text-[#66645f] mt-1">
                        Every listing in your Hostaway account is already imported.
                      </p>
                    )}
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {filteredListings.map((l, idx) => (
                      <li key={l.hostaway_listing_id}>
                        <button
                          type="button"
                          onClick={() => importFromHostaway(l)}
                          disabled={submitting}
                          className={`w-full flex items-start justify-between gap-4 py-2.5 px-2 -mx-2 rounded-md text-left hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors disabled:opacity-50 ${
                            idx < filteredListings.length - 1
                              ? 'border-b border-[rgba(30,25,20,0.06)] dark:border-[rgba(255,255,255,0.05)]'
                              : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-neutral-800 dark:text-[#f0efed] truncate">
                              {l.name}
                            </div>
                          </div>
                          <div className="shrink-0 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] tabular-nums uppercase tracking-[0.04em]">
                            ID · {l.hostaway_listing_id}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {error && (
                  <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={createManual}>
              <div className="px-5 pt-4 pb-3">
                <p className="text-[12px] text-neutral-500 dark:text-[#66645f] mb-3">
                  Creates an unlinked property. You can link it to a Hostaway
                  listing later from the property's page once the listing exists.
                </p>
                <label className="block">
                  <span className="block text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] mb-1">
                    Name
                  </span>
                  <input
                    ref={manualInputRef}
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="e.g. Ocean View Suite"
                    className="w-full px-3 py-2 text-[14px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors"
                    disabled={submitting}
                  />
                </label>
                {error && (
                  <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{error}</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !manualName.trim()}
                  className="px-4 py-1.5 text-[13px] font-medium bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] rounded-md hover:bg-neutral-800 dark:hover:bg-white transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
