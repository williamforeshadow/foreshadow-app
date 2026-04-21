'use client';

import React from 'react';

// Shared form primitives used across all property detail tabs.
// Kept visually tight and themed against the existing dark/light palette so
// every tab feels like the same surface.

export function SectionHeader({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
        {label}
      </h2>
      {right}
    </div>
  );
}

// One-sentence caption that sits below a SectionHeader and describes what
// kind of content lives in the section. Agent-authored copy keeps these
// oriented around examples rather than rules.
export function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug mb-4">
      {children}
    </p>
  );
}

export function Subheading({ label }: { label: string }) {
  return (
    <h3 className="text-[10px] font-semibold text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.08em] mt-5 mb-2">
      {label}
    </h3>
  );
}

export function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] mb-1">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-[11px] text-neutral-400 dark:text-[#66645f] mt-1 leading-snug">
          {hint}
        </span>
      )}
    </label>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input(props, ref) {
  return (
    <input
      ref={ref}
      {...props}
      className={`w-full px-3 py-2 text-[14px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors ${props.className ?? ''}`}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={`w-full px-3 py-2 text-[14px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors resize-y min-h-[80px] leading-snug ${props.className ?? ''}`}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select(props, ref) {
  return (
    <select
      ref={ref}
      {...props}
      className={`w-full px-3 py-2 text-[14px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors appearance-none bg-[url('data:image/svg+xml;utf8,<svg%20fill=%22none%22%20stroke=%22%2366645f%22%20viewBox=%220%200%2024%2024%22%20xmlns=%22http://www.w3.org/2000/svg%22><path%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%20stroke-width=%222%22%20d=%22M19%209l-7%207-7-7%22/></svg>')] bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8 ${props.className ?? ''}`}
    />
  );
});

export function ReadonlyRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-[rgba(255,255,255,0.05)] last:border-b-0">
      <span className="text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em]">
        {label}
      </span>
      <span className="text-[13px] text-neutral-800 dark:text-[#f0efed] tabular-nums">
        {value}
      </span>
    </div>
  );
}

// Floating save bar used by tabs that want explicit-save semantics (Access,
// Information). Stays docked to the bottom of the tab content area.
export function FloatingSaveBar({
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className="flex-shrink-0 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] bg-white/95 dark:bg-[#0b0b0c]/95 backdrop-blur-sm">
      <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1 text-[13px]">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            <span className="text-neutral-600 dark:text-[#a09e9a]">Unsaved changes</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onDiscard}
            disabled={saving}
            className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-1.5 text-[13px] font-medium bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] rounded-md hover:bg-neutral-800 dark:hover:bg-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Compact toast used across property tabs. Top-level pages manage the
// state; the primitive just handles rendering + animation.
export function Toast({
  kind,
  message,
}: {
  kind: 'success' | 'error';
  message: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw]"
    >
      <div
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis border ${
          kind === 'success'
            ? 'bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] border-neutral-800 dark:border-neutral-300'
            : 'bg-red-600 text-white border-red-700'
        }`}
      >
        {kind === 'success' ? (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
        <span className="truncate">{message}</span>
      </div>
    </div>
  );
}

// Hook-friendly toast state: handles timer + cleanup so pages don't have
// to reimplement it. Returns { toast, showToast } where `toast` is null
// when nothing is visible.
export function useToast(timeoutMs = 4500) {
  const [toast, setToast] = React.useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = React.useCallback(
    (kind: 'success' | 'error', message: string) => {
      setToast({ kind, message });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setToast(null), timeoutMs);
    },
    [timeoutMs]
  );

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast };
}
