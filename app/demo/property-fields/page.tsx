'use client';

// Demo fixtures for the per-property field overrides editor. Public (/demo is
// auth-exempt) so every state is browser-verifiable without a session — same
// reason /demo/task-detail exists. Local state only; nothing saves.

import { useState } from 'react';
import FieldOverridesEditor, { type BaseField } from '@/components/templates/FieldOverridesEditor';
import { createDefaultFieldOverrides, type FieldOverrides } from '@/lib/types';

const BASE_FIELDS: BaseField[] = [
  { id: 'f1', type: 'checkbox', label: 'Strip and remake all beds', required: true },
  { id: 'f2', type: 'checkbox', label: 'Restock consumables', required: true },
  { id: 'sep1', type: 'separator', label: 'Kitchen', required: false },
  { id: 'f3', type: 'yes-no', label: 'Dishwasher run and emptied?', required: true },
  { id: 'f4', type: 'text', label: 'Damage notes', required: false },
  { id: 'f5', type: 'rating', label: 'Overall readiness', required: true },
  { id: 'f6', type: 'photo', label: 'Entryway photo', required: false },
  { id: 'f7', type: 'photos', label: 'Damage photos', required: false },
];

export default function PropertyFieldsDemoPage() {
  const [overrides, setOverrides] = useState<FieldOverrides>(createDefaultFieldOverrides());
  const [empty, setEmpty] = useState(false);

  return (
    <div className="panel-form flex h-screen flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <div className="flex shrink-0 items-center gap-2 border-b p-3" style={{ borderColor: 'var(--task-line-soft)' }}>
        <button
          onClick={() => setEmpty((v) => !v)}
          className="rounded-full border px-3 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--task-line)', color: 'var(--task-ink-3)' }}
        >
          empty template: {String(empty)}
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--task-ink-3)' }}>
          demo mode — local state only
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] pb-6">
          <FieldOverridesEditor
            baseFields={empty ? [] : BASE_FIELDS}
            overrides={overrides}
            onChange={setOverrides}
          />
        </div>
      </div>

      <pre
        className="max-h-40 shrink-0 overflow-auto border-t p-3 text-[10px]"
        style={{ borderColor: 'var(--task-line-soft)', color: 'var(--task-ink-3)' }}
      >
        {JSON.stringify(overrides, null, 2)}
      </pre>
    </div>
  );
}
