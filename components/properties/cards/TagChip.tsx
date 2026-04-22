'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CARD_TAGS,
  TAG_CHIP_CLASSES,
  TAG_LABELS,
  type CardTag,
} from '@/lib/propertyCards';

// Inline tag pill that opens a menu of tags on click. Intentionally
// small — sits next to the card title row, not in a full form field.

export function TagChip({
  value,
  onChange,
}: {
  value: CardTag;
  onChange: (next: CardTag) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const chipClasses = TAG_CHIP_CLASSES[value];

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full border transition-colors ${chipClasses} hover:opacity-80`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change tag"
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        <span className="uppercase tracking-[0.04em]">{TAG_LABELS[value]}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 w-40 rounded-md border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#141312] shadow-lg overflow-hidden"
        >
          {CARD_TAGS.map((t) => {
            const isActive = t === value;
            return (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors ${
                  isActive
                    ? 'bg-[rgba(99,102,241,0.08)] dark:bg-[rgba(167,139,250,0.1)] text-neutral-900 dark:text-[#f0efed]'
                    : 'text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full border ${TAG_CHIP_CLASSES[t]}`}
                />
                {TAG_LABELS[t]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
