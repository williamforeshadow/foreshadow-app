'use client';

// Demo fixtures for the unified task detail panel. Public (/demo is
// auth-exempt) so the panel is browser-verifiable without a session.
// Saves apply locally (demo mode); the template detail is pre-seeded into
// the query cache so the checklist page works offline.

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queries';
import type { Template } from '@/components/DynamicCleaningForm';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { emptyDraft, type TaskDetailInput, type TaskDraft } from '@/components/tasks/detail/taskInput';

const DEMO_TEMPLATE: Template = {
  id: 'demo-template',
  name: 'Turnover clean',
  fields: [
    { id: 'f1', type: 'checkbox', label: 'Strip and remake all beds', required: true },
    { id: 'f2', type: 'checkbox', label: 'Restock consumables', required: true },
    { id: 'sep1', type: 'separator', label: 'Kitchen', required: false },
    { id: 'f3', type: 'yes-no', label: 'Dishwasher run and emptied?', required: true },
    { id: 'f4', type: 'text', label: 'Damage notes', required: false },
    { id: 'f5', type: 'rating', label: 'Overall readiness', required: true },
  ],
};

function baseTask(overrides: Partial<TaskDetailInput>): TaskDetailInput {
  return {
    task_id: 'demo-1',
    reservation_id: null,
    property_id: 'demo-prop',
    property_name: 'Cortez Hill · 4B',
    template_id: null,
    template_name: null,
    title: 'Upload Turo PDFs to Slack messages',
    description: null,
    priority: 'medium',
    department_id: null,
    department_name: null,
    status: 'in_progress',
    scheduled_date: '2026-07-17',
    scheduled_time: '14:00',
    form_metadata: null,
    bin_id: null,
    bin_name: 'Linens bin',
    is_binned: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_users: [],
    unread_comment_count: 1,
    ...overrides,
  };
}

const FIXTURES: { key: string; label: string; task: TaskDetailInput | null }[] = [
  {
    key: 'templated',
    label: 'Templated',
    task: baseTask({
      task_id: 'demo-templated',
      template_id: 'demo-template',
      template_name: 'Turnover clean',
      status: 'in_progress',
      form_metadata: {
        f1: { label: 'Strip and remake all beds', type: 'checkbox', value: true },
        f2: { label: 'Restock consumables', type: 'checkbox', value: true },
      },
    }),
  },
  {
    key: 'plain',
    label: 'Non-templated',
    task: baseTask({ task_id: 'demo-plain', status: 'not_started', title: 'Replace pool gate latch' }),
  },
  {
    key: 'contingent',
    label: 'Contingent',
    task: baseTask({
      task_id: 'demo-contingent',
      status: 'contingent',
      title: 'Guest-requested late checkout clean',
    }),
  },
  { key: 'draft', label: 'Draft', task: null },
];

export default function TaskDetailDemoPage() {
  const queryClient = useQueryClient();
  const [fixtureKey, setFixtureKey] = useState('templated');
  const [draft, setDraft] = useState<TaskDraft>(() =>
    emptyDraft({ title: 'New task from demo', property_name: 'Cortez Hill · 4B' })
  );
  const [creating, setCreating] = useState(false);

  // Pre-seed the template detail cache so ensureTemplateDetail never fetches.
  // Must happen during render (not an effect) — the panel's controller kicks
  // off template loading in a child effect that runs before parent effects.
  if (!queryClient.getQueryData(qk.templateDetail('demo-template', 'Cortez Hill · 4B'))) {
    queryClient.setQueryData(qk.templateDetail('demo-template', 'Cortez Hill · 4B'), DEMO_TEMPLATE);
    queryClient.setQueryData(qk.templateDetail('demo-template', null), DEMO_TEMPLATE);
  }

  const fixture = useMemo(() => FIXTURES.find((f) => f.key === fixtureKey)!, [fixtureKey]);

  return (
    <div className="flex h-screen flex-col bg-neutral-100 dark:bg-[#0F0F12]">
      <div className="flex shrink-0 items-center gap-2 p-3">
        {FIXTURES.map((f) => (
          <button
            key={f.key}
            onClick={() => setFixtureKey(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              f.key === fixtureKey
                ? 'border-transparent bg-[var(--accent-3)] text-white'
                : 'border-neutral-300 text-neutral-500 dark:border-[rgba(255,255,255,0.1)]'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-400">
          demo mode — saves are local
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 justify-end">
        {/* Full-height positioned area; the panel self-centers a capped card
            inside it, exactly as the production DESKTOP_TASK_PANEL_SLOT does. */}
        <div className="relative h-full w-full sm:w-[40%]">
          <TaskDetailPanel
            key={fixture.key}
            task={fixture.task}
            demo
            onClose={() => {}}
            draft={fixture.key === 'draft' ? draft : null}
            onDraftChange={setDraft}
            creating={creating}
            onConfirmCreate={async () => {
              setCreating(true);
              await new Promise((r) => setTimeout(r, 800));
              setCreating(false);
            }}
            onOpenInPage={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
