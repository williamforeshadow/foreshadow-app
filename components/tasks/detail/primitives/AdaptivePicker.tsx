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
  trigger,
  children,
  align = 'start',
  contentClassName,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  contentClassName?: string;
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
        <TaskSheet open={open} onOpenChange={onOpenChange} title={title}>
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
          className="px-2.5 pt-1.5 pb-2 font-mono text-[10px] uppercase tracking-[0.14em]"
          style={{ color: 'var(--task-ink-3)' }}
        >
          {title}
        </div>
        <div className="max-h-72 overflow-y-auto">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
