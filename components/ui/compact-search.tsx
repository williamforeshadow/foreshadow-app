'use client';

import { useEffect, useRef, useState } from 'react';

// Compact expandable search: a persistent icon button toggles a small text
// input alongside it. Stays expanded across blur events so it can be opened
// in parallel with other inline controls (e.g. the filter funnel); click the
// icon again to collapse. Shared across Schedule + Turnovers + future
// filterable surfaces so the search affordance reads identically everywhere.
export function CompactSearch({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = expanded || !!value;
  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={open ? 'Hide search' : 'Search'}
        aria-pressed={open}
        className={`p-1.5 rounded transition-colors ${
          open
            ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
            : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      {open && (
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-44 px-2 py-1.5 text-[13px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
        />
      )}
    </div>
  );
}
