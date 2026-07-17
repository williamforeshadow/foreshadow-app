"use client";

import * as React from "react";

// Global toast: call toast.success/error/info from anywhere (components,
// event handlers, fetch helpers). A single <Toaster /> in the root layout
// renders the stack. Visual design lifted from the properties-form Toast
// so the two look identical until the local one is retired.

type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
};

type Listener = (items: ToastItem[]) => void;

const DEFAULT_DURATION_MS = 4500;
const MAX_VISIBLE = 3;

let items: ToastItem[] = [];
let listener: Listener | null = null;
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  listener?.(items);
}

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  items = items.filter((t) => t.id !== id);
  emit();
}

function show(kind: ToastKind, message: string, duration = DEFAULT_DURATION_MS) {
  const id = nextId++;
  items = [...items, { id, kind, message, duration }].slice(-MAX_VISIBLE);
  timers.set(id, setTimeout(() => dismiss(id), duration));
  emit();
  return id;
}

export const toast = {
  success: (message: string, duration?: number) => show("success", message, duration),
  error: (message: string, duration?: number) => show("error", message, duration),
  info: (message: string, duration?: number) => show("info", message, duration),
  dismiss,
};

const KIND_CLASSES: Record<ToastKind, string> = {
  success:
    "bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-background border-neutral-800 dark:border-neutral-300",
  info: "bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-background border-neutral-800 dark:border-neutral-300",
  error: "bg-red-600 text-white border-red-700",
};

function KindIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") {
    return (
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function Toaster() {
  const [visible, setVisible] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    listener = setVisible;
    setVisible(items);
    return () => {
      if (listener === setVisible) listener = null;
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 max-w-[90vw]"
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
    >
      {visible.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium text-left border cursor-pointer animate-in fade-in slide-in-from-bottom-2 ${KIND_CLASSES[t.kind]}`}
        >
          <KindIcon kind={t.kind} />
          <span className="max-w-[70vw] sm:max-w-md">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
