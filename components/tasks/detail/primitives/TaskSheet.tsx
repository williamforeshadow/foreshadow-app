'use client';

import * as React from 'react';
import { Drawer } from 'vaul';
import { useEditableKeyboardOverlay } from '@/lib/useEditableKeyboardOverlay';
import { setChatKeyboardOverlay } from '@/lib/nativeKeyboard';

// Bottom sheet styled for the task detail panel: rounded top, drag handle,
// panel-scoped surfaces. Content is arbitrary; pickers compose TaskSheetOption
// rows inside it.
//
// Built on vaul so the drawer is a physical object: drag it from anywhere
// (vaul arbitrates against the inner list's scroll), flick or drag down to
// dismiss, rubber-band on overdrag. Gestures — plus the scrim tap and Escape
// — are the ways out; there is deliberately no X button.
export function TaskSheet({
  open,
  onOpenChange,
  title,
  titleHidden = false,
  children,
  className,
  overlayClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Keep the title for a11y but render it invisibly — for content that
   *  draws its own header (e.g. the filter drill-in's back row + label). */
  titleHidden?: boolean;
  children: React.ReactNode;
  /** For callers that live above the sheet's default z-50 — the agent chat
   *  drawer, for one. Pass the same z to both or the dim lands behind. */
  className?: string;
  overlayClassName?: string;
}) {
  // Any sheet content with an editable field gets the overlay-keyboard
  // treatment; bottom-anchored surfaces must also rise by the inset or the
  // field ends up behind the keyboard. Inline `bottom` (not transform) so
  // vaul's drag/settle translate is untouched. vaul's own input repositioning
  // is disabled below — this app's Capacitor keyboard system owns that job.
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

  // While the keyboard has the sheet lifted, the 65vh content cap no longer
  // fits — bottom inset + full-height sheet pushes the top past the notch.
  // Cap the WHOLE sheet to the strip left above the keyboard instead.
  const lifted = kb.typing && kb.keyboardInset > 0;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay
          className={`fixed inset-0 z-50 bg-black/50 ${overlayClassName ?? ''}`}
        />
        <Drawer.Content
          aria-describedby={undefined}
          className={`task-detail fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[18px] border-t outline-none ${className ?? ''}`}
          style={{
            background: 'var(--task-surface-1)',
            borderColor: 'var(--task-line)',
            bottom: lifted ? kb.keyboardInset : 0,
            maxHeight: lifted
              ? `calc(100dvh - ${kb.keyboardInset}px - env(safe-area-inset-top) - 12px)`
              : undefined,
          }}
          // Radix focuses the first focusable element on open — in a sheet with
          // a search field that means the keyboard erupts (and races the
          // overlay arming) before the user asked for it. A sheet opens showing
          // its list; the keyboard waits for a tap on the field.
          onOpenAutoFocus={(e) => e.preventDefault()}
          {...kb.handlers}
        >
          <div
            className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full"
            style={{ background: 'var(--task-line)' }}
          />
          <Drawer.Title asChild>
            <div
              className={
                titleHidden
                  ? 'sr-only'
                  : 'px-[18px] pt-3 pb-3 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]'
              }
              style={titleHidden ? undefined : { color: 'var(--task-ink-3)' }}
            >
              {title}
            </div>
          </Drawer.Title>
          {/* flex-1 min-h-0 lets this scroll region COMPRESS when the lifted
              sheet's maxHeight bites; with an auto-height sheet (the normal
              case) flex-grow has no free space to hand out, so the 65vh cap
              still governs. */}
          <div
            className={`px-[18px] pb-[calc(1.75rem+env(safe-area-inset-bottom))] max-h-[65vh] flex-1 min-h-0 overflow-y-auto ${
              titleHidden ? 'pt-2' : ''
            }`}
          >
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
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
