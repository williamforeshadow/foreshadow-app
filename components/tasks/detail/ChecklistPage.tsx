'use client';

import * as React from 'react';
import DynamicCleaningForm, { type Template } from '@/components/DynamicCleaningForm';
import { MonoLabel, IconButton } from './sections/HeaderSections';

// The checklist as its own page. Desktop: absolute takeover of the panel;
// mobile: the panel is already fixed inset-0, so this stacks the same way.
// The caller must flush window.__currentFormSave when this closes (the
// controller's openView does).
export function ChecklistPage({
  taskId,
  propertyName,
  template,
  templateName,
  formMetadata,
  onSaveForm,
  readOnly,
  loading,
  completed,
  total,
  onBack,
}: {
  taskId: string;
  propertyName: string | null;
  template: Template | null;
  templateName: string | null;
  formMetadata: Record<string, unknown> | null;
  onSaveForm: (formData: Record<string, unknown>) => Promise<void>;
  readOnly: boolean;
  loading: boolean;
  completed: number;
  total: number;
  onBack: () => void;
}) {
  const allDone = total > 0 && completed === total;
  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <div
        className="shrink-0 border-b px-[18px] pb-3"
        style={{ borderColor: 'var(--task-line-soft)' }}
      >
        <div className="flex h-12 items-center justify-between">
          <div className="-ml-2">
            <IconButton label="Back" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </IconButton>
          </div>
          <MonoLabel>{templateName ?? 'Checklist'}</MonoLabel>
          <div className="w-[26px]">
            {readOnly && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--task-ink-3)" strokeWidth="1.6" strokeLinecap="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <MonoLabel>Steps</MonoLabel>
          <div className="h-[2px] flex-1 overflow-hidden rounded-[2px]" style={{ background: 'var(--task-surface-2)' }}>
            <div
              className="h-full transition-[width] duration-300"
              style={{
                width: total > 0 ? `${(completed / total) * 100}%` : '0%',
                background: allDone ? 'var(--task-green)' : 'var(--task-accent)',
              }}
            />
          </div>
          <MonoLabel style={{ color: 'var(--task-ink-2)' }}>{`${completed}/${total}`}</MonoLabel>
        </div>
        {readOnly && (
          <MonoLabel className="mt-2" style={{ color: 'var(--task-amber)' }}>
            Read only — start the task to edit
          </MonoLabel>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto px-[18px] py-4"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        {loading ? (
          <MonoLabel>Loading checklist…</MonoLabel>
        ) : template ? (
          <DynamicCleaningForm
            cleaningId={taskId}
            propertyName={propertyName ?? ''}
            template={template}
            formMetadata={formMetadata}
            onSave={onSaveForm}
            readOnly={readOnly}
          />
        ) : (
          <MonoLabel>Checklist unavailable</MonoLabel>
        )}
      </div>
    </div>
  );
}
