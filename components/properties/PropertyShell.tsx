'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React from 'react';
import { PropertyProvider, usePropertyContext } from './PropertyContext';

// ---- Tab definitions -------------------------------------------------------
// The detail routes now live on two tiers:
//
//   /properties/[id]/knowledge[/...]    ← primary tab "Knowledge"
//   /properties/[id]/tasks              ← primary tab "Tasks"
//   /properties/[id]/schedule           ← primary tab "Schedule"
//
// "Knowledge" expands into a second row of pill tabs for the eight knowledge
// sub-sections. Tasks and Schedule have no sub-tabs for now.
//
// The root `/properties/[id]` URL redirects to `./knowledge`, so every rendered
// path falls under exactly one primary tab.

interface PrimaryTab {
  id: 'knowledge' | 'tasks' | 'schedule';
  label: string;
  // First path segment after `/properties/:id`. "knowledge" for the knowledge
  // group, "tasks" / "schedule" for the siblings.
  segment: string;
}

const PRIMARY_TABS: PrimaryTab[] = [
  { id: 'knowledge', label: 'Knowledge', segment: 'knowledge' },
  { id: 'tasks', label: 'Tasks', segment: 'tasks' },
  { id: 'schedule', label: 'Schedule', segment: 'schedule' },
];

interface KnowledgePill {
  id: string;
  label: string;
  // Trailing slug appended to `/properties/:id/knowledge`. Empty string for
  // the index (Information).
  slug: string;
}

const KNOWLEDGE_PILLS: KnowledgePill[] = [
  { id: 'info', label: 'Information', slug: '' },
  { id: 'access', label: 'Access', slug: 'access' },
  { id: 'connectivity', label: 'Connectivity', slug: 'connectivity' },
  { id: 'interior', label: 'Interior', slug: 'interior' },
  { id: 'exterior', label: 'Exterior', slug: 'exterior' },
  { id: 'vendors', label: 'Vendors', slug: 'vendors' },
  { id: 'notes', label: 'Notes', slug: 'notes' },
  { id: 'documents', label: 'Documents', slug: 'documents' },
];

// Client wrapper around the property detail shell. Responsible for
// fetching the property (via PropertyProvider), rendering the shared
// header + two-tier tab strip, and routing tab children.
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

  // Derive the active primary tab + (if Knowledge) the active pill from the
  // current URL. We split the path into segments after `/properties/:id`:
  //   /properties/:id                           → primary=knowledge (redirect target), pill=info
  //   /properties/:id/knowledge                 → primary=knowledge, pill=info
  //   /properties/:id/knowledge/access          → primary=knowledge, pill=access
  //   /properties/:id/tasks                     → primary=tasks
  //   /properties/:id/schedule                  → primary=schedule
  const { activePrimaryId, activePillId } = React.useMemo(() => {
    const base = `/properties/${propertyId}`;
    const trail = pathname.startsWith(base)
      ? pathname.slice(base.length).replace(/^\/+/, '')
      : '';
    const segs = trail === '' ? [] : trail.split('/');
    const first = segs[0] ?? '';

    const primary = PRIMARY_TABS.find((t) => t.segment === first);
    const primaryId = (primary?.id ?? 'knowledge') as PrimaryTab['id'];

    // Pill resolution is only meaningful when the primary tab is Knowledge.
    let pillId: string = 'info';
    if (primaryId === 'knowledge') {
      const sub = segs[1] ?? '';
      const match = KNOWLEDGE_PILLS.find((p) => p.slug && p.slug === sub);
      pillId = match?.id ?? 'info';
    }
    return { activePrimaryId: primaryId, activePillId: pillId };
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

          {/* Primary tab strip: Knowledge / Tasks / Schedule */}
          <nav
            aria-label="Property sections"
            className="flex items-end gap-0.5 overflow-x-auto -mx-5 sm:-mx-8 px-5 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {PRIMARY_TABS.map((tab) => {
              const href = `/properties/${propertyId}/${tab.segment}`;
              const isActive = activePrimaryId === tab.id;
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

          {/* Secondary pill row — renders only under the Knowledge primary tab */}
          {activePrimaryId === 'knowledge' && (
            <nav
              aria-label="Knowledge sub-sections"
              className="flex items-center gap-1.5 overflow-x-auto -mx-5 sm:-mx-8 px-5 sm:px-8 pt-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {KNOWLEDGE_PILLS.map((pill) => {
                const href = pill.slug
                  ? `/properties/${propertyId}/knowledge/${pill.slug}`
                  : `/properties/${propertyId}/knowledge`;
                const isActive = activePillId === pill.id;
                return (
                  <Link
                    key={pill.id}
                    href={href as any}
                    className={`shrink-0 px-3 py-1 rounded-full text-[12px] font-medium border whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)] border-[var(--accent-3)]/30 dark:border-[var(--accent-1)]/30'
                        : 'bg-transparent text-neutral-600 dark:text-[#a09e9a] border-transparent hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-800 dark:hover:text-[#f0efed]'
                    }`}
                  >
                    {pill.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {children}
      </div>
    </div>
  );
}
