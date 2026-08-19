'use client';

import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/lib/useIsMobile';
import { TaskSheet } from './TaskSheet';

// One picker API for the task panel: bottom sheet on mobile, anchored popover
// on desktop. The trigger renders in place; `children` is the option list
// (compose TaskOptionRow rows). Close by calling onOpenChange(false) from an
// option's onSelect.
export function AdaptivePicker({
  open,
  onOpenChange,
  title,
  titleHidden = false,
  trigger,
  children,
  align = 'start',
  contentClassName,
  scrollAreaClassName = 'max-h-72',
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Keep the title for a11y but render it invisibly — for content that
   *  draws its own header (e.g. the filter drill-in's back row + label). */
  titleHidden?: boolean;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  contentClassName?: string;
  /** Height cap for the desktop popover's scroll region. Taller pickers
   *  (the filter drill-in) pass a bigger cap. */
  scrollAreaClassName?: string;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();

  // Locked (read-only) — render the trigger inert, no picker.
  if (disabled) return <>{trigger}</>;

  if (isMobile) {
    return (
      <>
        {/* Trigger stays inline; the sheet portals to the viewport. */}
        <span onClick={() => onOpenChange(true)} className="contents">
          {trigger}
        </span>
        <TaskSheet
          open={open}
          onOpenChange={onOpenChange}
          title={title}
          titleHidden={titleHidden}
        >
          {children}
        </TaskSheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger as React.ReactElement}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={`task-detail w-64 p-1.5 border ${contentClassName ?? ''}`}
        style={{
          background: 'var(--task-surface-1)',
          borderColor: 'var(--task-line)',
        }}
      >
        <div
          className={
            titleHidden
              ? 'sr-only'
              : 'px-2.5 pt-1.5 pb-2 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]'
          }
          style={titleHidden ? undefined : { color: 'var(--task-ink-3)' }}
        >
          {title}
        </div>
        <div className={`${scrollAreaClassName} overflow-y-auto`}>{children}</div>
      </PopoverContent>
    </Popover>
  );
}
