'use client';

import { useRouter } from 'next/navigation';
import {
  PropertyTaskDetailOverlay,
  type OverlayTaskInput,
} from '@/components/properties/tasks/PropertyTaskDetailOverlay';

// Client mount for the dedicated /tasks/[id] page.
//
// All this does is render PropertyTaskDetailOverlay in `layout="page"`
// mode — i.e. full-bleed centered column instead of right-1/3 absolute
// overlay. Every interactive piece (edits, comments, attachments,
// time tracking, bin moves) is owned by the existing overlay component
// and hits the same API endpoints it always has, so we get the full
// task UX without duplicating any of the plumbing.
//
// Close behaviour: navigate to /tasks (the list root), not router.back().
// Predictable destination across all entry points (Slack tap, in-app
// "open in dedicated page" button, bookmark) and avoids the no-history
// edge case where back() bounces back to the page itself.
//
// "Open in dedicated page" affordance is suppressed in this mode by
// PropertyTaskDetailOverlay itself — we're already on the page.
export function TaskDetailRoute({ task }: { task: OverlayTaskInput }) {
  const router = useRouter();

  return (
    <PropertyTaskDetailOverlay
      task={task}
      onClose={() => router.push('/tasks')}
      layout="page"
    />
  );
}
