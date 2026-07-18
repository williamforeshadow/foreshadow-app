'use client';

import * as React from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { JSONContent } from '@tiptap/react';

export function MonoLabel({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`font-mono text-[10px] uppercase tracking-[0.14em] ${className}`}
      style={{ color: 'var(--task-ink-3)', ...style }}
    >
      {children}
    </div>
  );
}

// forwardRef + prop spread so it can serve as a Radix Popover trigger (asChild
// needs a real ref/anchor — a display:contents wrapper has no box and mislays
// the popover at the container origin).
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  {
    label: string;
    children: React.ReactNode;
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButton({ label, children, className = '', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`flex h-[34px] w-[34px] items-center justify-center rounded-lg transition-transform active:scale-95 hover:bg-[var(--task-surface-2)] ${className}`}
      style={{ color: 'var(--task-ink-2)' }}
    >
      {children}
    </button>
  );
});

// Header: back/close · mono micro-label · overflow slot
export function HeaderBar({
  label,
  onClose,
  closeGlyph,
  menu,
  accessory,
}: {
  label: string;
  onClose: () => void;
  closeGlyph: 'back' | 'x';
  menu: React.ReactNode;
  accessory?: React.ReactNode;
}) {
  return (
    <div className="flex h-9 items-center justify-between">
      <div className="-ml-2 flex items-center">
        {accessory}
        <IconButton label={closeGlyph === 'back' ? 'Back' : 'Close'} onClick={onClose}>
          {closeGlyph === 'back' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          )}
        </IconButton>
      </div>
      <MonoLabel>{label}</MonoLabel>
      <div className="-mr-2 flex items-center">{menu}</div>
    </div>
  );
}

// Editable title (blur-save). Auto-grows up to 3 lines so the full title is
// visible; past that it scrolls internally.
const TITLE_LINE_HEIGHT = 26.25; // 21px * 1.25
const TITLE_MAX_LINES = 3;

export function TitleSection({
  title,
  onTitleChange,
  onTitleBlur,
  readOnly,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  onTitleBlur: () => void;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = TITLE_LINE_HEIGHT * TITLE_MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max + 1 ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(resize, [title, resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={title}
      onChange={(e) => {
        onTitleChange(e.target.value);
        resize();
      }}
      onBlur={onTitleBlur}
      readOnly={readOnly}
      placeholder="Task title"
      className="mt-2 w-full resize-none bg-transparent text-[21px] font-medium leading-[1.25] tracking-[-0.02em] outline-none [scrollbar-width:none]"
      style={{ color: 'var(--task-ink-1)' }}
    />
  );
}

export function DescriptionSection({
  description,
  onChange,
  onBlur,
  readOnly,
  collapsedByDefault,
}: {
  description: JSONContent | null;
  onChange: (json: JSONContent) => void;
  onBlur: () => void;
  readOnly?: boolean;
  /** Templated tasks: description is secondary — start collapsed when empty. */
  collapsedByDefault?: boolean;
}) {
  const hasContent = !!description && JSON.stringify(description).includes('"text"');
  const [expanded, setExpanded] = useState(!collapsedByDefault || hasContent);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors hover:text-[var(--task-ink-2)]"
        style={{ color: 'var(--task-ink-3)' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add description
      </button>
    );
  }

  return (
    <div
      className="rounded-[10px] px-3 py-2"
      style={{ background: 'var(--task-surface-1)' }}
    >
      <MonoLabel className="mb-1.5">Description</MonoLabel>
      <RichTextEditor
        content={description}
        onChange={onChange}
        onBlur={onBlur}
        editable={!readOnly}
        placeholder="Add details…"
        className="text-[14px]"
      />
    </div>
  );
}
