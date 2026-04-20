'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';

interface PropertyRow {
  id: string;
  name: string;
  hostaway_name: string | null;
  hostaway_listing_id: number | null;
  created_at: string;
  updated_at: string;
}

interface PropertyGroup {
  label: string;
  sublabel: string;
  items: PropertyRow[];
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/properties');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch properties');
        setProperties(data.properties || []);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch properties');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { groups, linkedCount, unlinkedCount } = useMemo(() => {
    const linked: PropertyRow[] = [];
    const unlinked: PropertyRow[] = [];
    for (const p of properties) {
      if (p.hostaway_listing_id != null) linked.push(p);
      else unlinked.push(p);
    }
    linked.sort((a, b) => a.name.localeCompare(b.name));
    unlinked.sort((a, b) => a.name.localeCompare(b.name));

    const result: PropertyGroup[] = [];
    if (linked.length > 0) {
      result.push({
        label: 'Linked to Hostaway',
        sublabel: `${linked.length}`,
        items: linked,
      });
    }
    if (unlinked.length > 0) {
      result.push({
        label: 'Unlinked',
        sublabel: `${unlinked.length}`,
        items: unlinked,
      });
    }
    return { groups: result, linkedCount: linked.length, unlinkedCount: unlinked.length };
  }, [properties]);

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex h-full overflow-hidden">
          <div className="w-full flex flex-col min-w-0">
            {/* Header */}
            <div className="flex-shrink-0 px-8 pt-6 pb-4">
              <h1 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
                Properties
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
                <span>
                  {properties.length} total
                </span>
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
                    Sync from Hostaway or create one manually to get started
                  </p>
                </div>
              ) : (
                <div className="px-8 pb-8">
                  {groups.map((group) => {
                    const isCollapsed = collapsedSections.has(group.label);
                    return (
                      <div key={group.label} className="pt-5">
                        {/* Section header */}
                        <button
                          onClick={() => toggleSection(group.label)}
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

                        {/* Property rows */}
                        {!isCollapsed && (
                          <div className="flex flex-col">
                            {group.items.map((item, idx) => {
                              const showHostawayName =
                                item.hostaway_name && item.hostaway_name !== item.name;
                              return (
                                <div
                                  key={item.id}
                                  className={`py-3.5 px-3 -mx-3 rounded-lg transition-colors hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)] ${
                                    idx < group.items.length - 1
                                      ? 'border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)]'
                                      : ''
                                  }`}
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
                                      {item.hostaway_listing_id != null ? (
                                        <div className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] tabular-nums tracking-[0.04em] uppercase whitespace-nowrap">
                                          ID · {item.hostaway_listing_id}
                                        </div>
                                      ) : (
                                        <div className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] tracking-[0.04em] uppercase whitespace-nowrap">
                                          Not linked
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
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
        </div>
      </div>
    </div>
  );
}
