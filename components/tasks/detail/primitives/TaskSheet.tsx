'use client';

import * as React from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useEditableKeyboardOverlay } from '@/lib/useEditableKeyboardOverlay';
import { setChatKeyboardOverlay } from '@/lib/nativeKeyboard';

// Bottom sheet styled for the task detail panel: rounded top, drag handle,
// panel-scoped surfaces. Content is arbitrary; pickers compose TaskSheetOption
// rows inside it.
export function TaskSheet({
  open,
  onOpenChange,
  title,
  children,
  className,
  overlayClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  /** For callers that live above the sheet's default z-50 — the agent chat
   *  drawer, for one. Pass the same z to both or the dim lands behind. */
  className?: string;
  overlayClassName?: string;
}) {
  // Any sheet content with an editable field gets the overlay-keyboard
  // treatment; bottom-anchored surfaces must also rise by the inset or the
  // field ends up behind the keyboard. Inline `bottom` (not transform) so
  // Radix's slide animation is untouched.
  const kb = useEditableKeyboardOverlay();

  // Arm overlay for the sheet's whole lifetime, not just from first touch:
  // an autofocused field raises the keyboard with no touch preceding it, and
  // arming at focus time loses the race against the keyboard animation (the
  // WebView resizes and the screen jumps). Restored on close.
  React.useEffect(() => {
    if (!open) return;
    void setChatKeyboardOverlay(true);
    return () => void setChatKeyboardOverlay(false);
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName={overlayClassName}
        className={`task-detail border-t p-0 rounded-t-[18px] gap-0 ${className ?? ''}`}
        style={{
          background: 'var(--task-surface-1)',
          borderColor: 'var(--task-line)',
          bottom: kb.typing && kb.keyboardInset > 0 ? kb.keyboardInset : undefined,
        }}
        {...kb.handlers}
      >
        <div
          className="mx-auto mt-2.5 h-1 w-9 rounded-full"
          style={{ background: 'var(--task-line)' }}
        />
        <SheetTitle asChild>
          <div
            className="px-[18px] pt-3 pb-3 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
            style={{ color: 'var(--task-ink-3)' }}
          >
            {title}
          </div>
        </SheetTitle>
        <div
          className="px-[18px] pb-[calc(1.75rem+env(safe-area-inset-bottom))] max-h-[65vh] overflow-y-auto"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// A tappable row inside a TaskSheet (or desktop popover list): dot/leading
// slot, label, trailing check when selected.
export function TaskOptionRow({
  selected,
  onSelect,
  leading,
  children,
  disabled,
}: {
  selected?: boolean;
  onSelect: () => void;
  leading?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors min-h-[50px] active:bg-[var(--task-surface-2)] hover:bg-[var(--task-surface-2)] disabled:opacity-40"
    >
      {leading}
      <span className="flex-1 text-[15px]" style={{ color: selected ? 'var(--task-ink-1)' : 'var(--task-ink-2)' }}>
        {children}
      </span>
      {selected && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--task-accent)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      )}
    </button>
  );
}
