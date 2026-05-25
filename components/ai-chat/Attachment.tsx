'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

// Generic collapsible "attachment" shell for visual content rendered inside
// an assistant chat message. Owns the collapsed/expanded affordance, the
// border + hover styling, and the max-height scroll on expand.
//
// The shell is content-agnostic on purpose: TaskAttachment is the first
// consumer (large task-result sets), but reservations, image galleries,
// comment threads, and any other future visual block can reuse this same
// shell by passing their own `title` (e.g. "5 reservations", "3 photos",
// "12 comments") and rendering whatever they want as children.
//
// Naming inside the chat is the consumer's concern — the shell only
// renders what it's given. Each instance owns its own expand state, so
// multiple attachments in the same conversation expand independently.
export function Attachment({
  title,
  children,
  defaultExpanded = false,
}: {
  /** Collapsed-state label, e.g. "12 tasks" or "3 photos". */
  title: ReactNode;
  /** Body rendered when the attachment is expanded. */
  children: ReactNode;
  /** Start in the expanded state. Defaults to collapsed. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--muted-foreground)_10%,transparent)]"
      >
        <span className="text-sm font-medium text-[var(--foreground)]">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`text-[var(--muted-foreground)] transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 p-2">{children}</div>
      )}
    </div>
  );
}
