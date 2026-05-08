'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Minimal shape from /api/hostaway/listings?available=true
interface HostawayListing {
  hostaway_listing_id: number;
  name: string;
  already_linked: boolean;
  linked_property_id: string | null;
  linked_property_name: string | null;
}

interface Props {
  // The property being linked. Its name + id are shown in the header and
  // confirmation copy.
  survivorId: string;
  survivorName: string;
  // When true, surface the fact that linking will also flip is_active → true.
  survivorIsInactive?: boolean;
  onClose: () => void;
  // Called after the link succeeds. Parent is expected to refresh data and
  // show a toast.
  onLinked: (result: {
    survivorId: string;
    chosen: HostawayListing;
  }) => void;
}

// Modal used from the property detail page (Hostaway section → "Link to
// listing"). Fetches the live Hostaway listings picker — filtered to those
// not yet bound to an app property — lets the user pick one, confirms, and
// POSTs /api/properties/:id/link.
//
// Non-destructive: linking just stamps hostaway_listing_id + hostaway_name
// onto the existing row; nothing is merged or deleted.
export function LinkHostawayModal({
  survivorId,
  survivorName,
  survivorIsInactive = false,
  onClose,
  onLinked,
}: Props) {
  const [listings, setListings] = useState<HostawayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<HostawayListing | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const loadListings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/hostaway/listings?available=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load Hostaway listings');
      setListings((data.listings || []) as HostawayListing[]);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load Hostaway listings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useEffect(() => {
    if (!selected && !loading) searchRef.current?.focus();
  }, [selected, loading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) => {
      const fields = [l.name, String(l.hostaway_listing_id)];
      return fields.some((f) => f.toLowerCase().includes(q));
    });
  }, [listings, query]);

  const handleConfirm = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/properties/${survivorId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostaway_listing_id: selected.hostaway_listing_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Link failed');
      onLinked({ survivorId, chosen: selected });
    } catch (err: any) {
      setSubmitError(err.message || 'Link failed');
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
        aria-label="Link to Hostaway"
      >
        <div className="w-full max-w-[520px] bg-white dark:bg-background border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] rounded-lg shadow-2xl pointer-events-auto flex flex-col max-h-[80vh]">
          <div className="px-5 pt-5 pb-3 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
            <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-[#f0efed] tracking-tight">
              Link to Hostaway
            </h2>
            <p className="text-[12px] text-neutral-500 dark:text-[#66645f] mt-1 leading-snug">
              Bind{' '}
              <span className="font-medium text-neutral-700 dark:text-[#a09e9a]">
                {survivorName}
              </span>{' '}
              to a Hostaway listing. Reservations, tasks, and bins on this
              property stay as they are — only the Hostaway linkage is added,
              and sync will keep Hostaway details up to date going forward.
            </p>
          </div>

          {!selected ? (
            <>
              <div className="px-5 pt-4 pb-2">
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
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Hostaway listings by name or ID…"
                    className="w-full pl-8 pr-3 py-2 text-[13px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto px-5 pb-2 min-h-[140px]">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : loadError ? (
                  <div className="py-4 text-[13px] text-red-600 dark:text-red-400">
                    {loadError}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-[13px] text-neutral-600 dark:text-[#a09e9a]">
                      {listings.length === 0
                        ? 'No available Hostaway listings.'
                        : 'No matches.'}
                    </p>
                    {listings.length === 0 && (
                      <p className="text-[12px] text-neutral-500 dark:text-[#66645f] mt-1">
                        Every listing in your Hostaway account is already linked to a property.
                      </p>
                    )}
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {filtered.map((l, idx) => (
                      <li key={l.hostaway_listing_id}>
                        <button
                          type="button"
                          onClick={() => setSelected(l)}
                          className={`w-full flex items-start justify-between gap-4 py-2.5 px-2 -mx-2 rounded-md text-left hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors ${
                            idx < filtered.length - 1
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
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="px-5 py-4">
                <div className="text-[13px] text-neutral-700 dark:text-[#a09e9a] leading-relaxed">
                  Link{' '}
                  <span className="font-medium text-neutral-900 dark:text-[#f0efed]">
                    {survivorName}
                  </span>{' '}
                  to Hostaway listing{' '}
                  <span className="font-medium text-neutral-900 dark:text-[#f0efed]">
                    {selected.name}
                  </span>{' '}
                  <span className="text-neutral-500 dark:text-[#66645f] tabular-nums">
                    (ID {selected.hostaway_listing_id})
                  </span>
                  ?
                </div>

                <ul className="mt-3 space-y-1 text-[12px] text-neutral-500 dark:text-[#66645f]">
                  <li>
                    <span className="inline-block w-3 text-neutral-400 dark:text-[#66645f]">·</span>{' '}
                    Keeps <span className="font-medium text-neutral-700 dark:text-[#a09e9a]">{survivorName}</span> as the property name
                  </li>
                  <li>
                    <span className="inline-block w-3 text-neutral-400 dark:text-[#66645f]">·</span>{' '}
                    Leaves existing reservations, tasks, and bins untouched
                  </li>
                  <li>
                    <span className="inline-block w-3 text-neutral-400 dark:text-[#66645f]">·</span>{' '}
                    Hostaway sync will start updating this property going forward
                  </li>
                  {survivorIsInactive && (
                    <li>
                      <span className="inline-block w-3 text-neutral-400 dark:text-[#66645f]">·</span>{' '}
                      Activates{' '}
                      <span className="font-medium text-neutral-700 dark:text-[#a09e9a]">{survivorName}</span>{' '}
                      (currently inactive)
                    </li>
                  )}
                </ul>

                {submitError && (
                  <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">
                    {submitError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setSubmitError(null);
                  }}
                  disabled={submitting}
                  className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors disabled:opacity-50"
                >
                  Back
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={submitting}
                    className="px-4 py-1.5 text-[13px] font-medium bg-[var(--accent-3)] text-white rounded-md hover:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Linking…' : 'Confirm link'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default LinkHostawayModal;
