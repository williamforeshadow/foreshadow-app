'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React from 'react';
import { PropertyProvider, usePropertyContext } from './PropertyContext';

interface TabDef {
  id: string;
  label: string;
  // Trailing slug appended to `/properties/:id`. Empty string for the
  // index tab (Information).
  slug: string;
}

const TABS: TabDef[] = [
  { id: 'info', label: 'Information', slug: '' },
  { id: 'access', label: 'Access', slug: 'access' },
  { id: 'interior', label: 'Interior', slug: 'interior' },
  { id: 'exterior', label: 'Exterior', slug: 'exterior' },
  { id: 'vendors', label: 'Vendors', slug: 'vendors' },
  { id: 'notes', label: 'Notes', slug: 'notes' },
  { id: 'documents', label: 'Documents', slug: 'documents' },
];

// Client wrapper around the property detail shell. Responsible for
// fetching the property (via PropertyProvider), rendering the shared
// header and tab strip, and routing tab children.
export function PropertyShell({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  return (
    <PropertyProvider propertyId={propertyId}>
      <ShellBody propertyId={propertyId}>{children}</ShellBody>
    </PropertyProvider>
  );
}

function ShellBody({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  const { property, loading, error } = usePropertyContext();
  const router = useRouter();
  const pathname = usePathname() || '';

  // Determine which tab is active by comparing the trailing path segment
  // after /properties/:id. We match the longest-matching slug so that
  // nested routes (e.g. future /interior/rooms/foo) still highlight the
  // parent tab.
  const activeTabId = React.useMemo(() => {
    const base = `/properties/${propertyId}`;
    if (pathname === base || pathname === `${base}/`) return 'info';
    const trail = pathname.slice(base.length + 1); // strip "base/"
    const firstSeg = trail.split('/')[0];
    const match = TABS.find((t) => t.slug && t.slug === firstSeg);
    return match?.id ?? 'info';
  }, [pathname, propertyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-neutral-500 dark:text-[#a09e9a] text-sm mb-4">
          {error || 'Property not found'}
        </p>
        <button
          onClick={() => router.push('/properties')}
          className="text-[13px] text-neutral-700 dark:text-[#f0efed] underline"
        >
          ← Back to Properties
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + tab strip */}
      <div className="flex-shrink-0 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
        <div className="max-w-[760px] mx-auto px-5 sm:px-8 pt-4 sm:pt-6 pb-0">
          <Link
            href="/properties"
            className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#f0efed] uppercase tracking-[0.04em] font-medium mb-4 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All Properties
          </Link>

          <div className="mb-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed] leading-tight">
                {property.name}
              </h1>
              {!property.is_active && (
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] rounded-md bg-neutral-200 dark:bg-[#2a2825] text-neutral-600 dark:text-[#a09e9a]">
                  Inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
              {property.hostaway_listing_id != null ? (
                <>
                  <span className="tabular-nums">
                    Hostaway ID · {property.hostaway_listing_id}
                  </span>
                  {property.hostaway_name && property.hostaway_name !== property.name && (
                    <>
                      <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                      <span className="normal-case tracking-normal text-neutral-500 dark:text-[#66645f]">
                        Hostaway: {property.hostaway_name}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span>Not linked to Hostaway</span>
              )}
            </div>
          </div>

          {/* Tab strip: horizontal scroll on mobile, overflow-visible on
              desktop. Scrollbar hidden; arrow-key / swipe works naturally. */}
          <nav className="flex items-end gap-0.5 overflow-x-auto -mx-5 sm:-mx-8 px-5 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tab) => {
              const href = tab.slug
                ? `/properties/${propertyId}/${tab.slug}`
                : `/properties/${propertyId}`;
              const isActive = activeTabId === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={href as any}
                  className={`shrink-0 px-3 py-2 text-[13px] font-medium -mb-px border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-[var(--accent-3)] dark:border-[var(--accent-1)] text-neutral-900 dark:text-[#f0efed]'
                      : 'border-transparent text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#a09e9a]'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {children}
      </div>
    </div>
  );
}
