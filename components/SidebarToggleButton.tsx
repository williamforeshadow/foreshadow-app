'use client';

import { useSidebar } from '@/lib/sidebarContext';

interface SidebarToggleButtonProps {
  className?: string;
}

// Small icon button that toggles the global sidebar. Designed to drop into
// any page's top header so the toggle stays in a consistent screen position
// (top-left of the content chrome) regardless of which route is mounted.
export function SidebarToggleButton({ className = '' }: SidebarToggleButtonProps) {
  const { isOpen, toggle } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? 'Hide sidebar' : 'Show sidebar'}
      aria-pressed={isOpen}
      title={isOpen ? 'Hide sidebar' : 'Show sidebar'}
      className={`inline-flex items-center justify-center p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${className}`}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    </button>
  );
}
