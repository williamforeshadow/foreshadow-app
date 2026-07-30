'use client';

// The two doors of the automations section. This replaced the tab bar that
// used to sit at the top of both lists.

import Link from 'next/link';
import { Slack } from 'lucide-react';
import TasksIcon from '@/components/icons/TasksIcon';

// Rendered nodes rather than component refs, so each icon can take the props
// its own source expects.
const DESTINATIONS = [
  {
    href: '/automations/tasks',
    label: 'Tasks',
    description: 'Generate tasks from templates on reservation events.',
    // The sidebar's Tasks glyph, so the two agree.
    icon: <TasksIcon className="h-5 w-5" />,
  },
  {
    href: '/automations/new-engine',
    label: 'Slack',
    description: 'Post Slack messages from triggers and conditions.',
    icon: <Slack className="h-5 w-5" aria-hidden />,
  },
];

export default function AutomationsHub() {
  return (
    <div
      className="panel-form flex h-full flex-col overflow-y-auto"
      style={{ background: 'var(--task-surface-0)' }}
    >
      {/* Centred in the pane, matching the lists' 46rem column. */}
      <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col justify-center px-[18px] py-12">
        {/* No title here — the page's WindowHeader owns it now. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {DESTINATIONS.map(({ href, label, description, icon }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-3 rounded-xl border p-5 transition-colors hover:bg-[var(--task-surface-2)]"
              style={{ background: 'var(--task-surface-1)', borderColor: 'var(--task-line)' }}
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ background: 'var(--task-accent-soft)', color: 'var(--task-accent)' }}
              >
                {icon}
              </span>
              <span>
                <span
                  className="block text-[length:var(--task-fs-option)] font-medium"
                  style={{ color: 'var(--task-ink-1)' }}
                >
                  {label}
                </span>
                <span
                  className="mt-1 block text-[length:var(--task-fs-body-sm)]"
                  style={{ color: 'var(--task-ink-3)' }}
                >
                  {description}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
