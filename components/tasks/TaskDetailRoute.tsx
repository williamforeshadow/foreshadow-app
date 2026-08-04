'use client';

import {
  PropertyTaskDetailOverlay,
  type OverlayTaskInput,
} from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import { useBackNavigation } from '@/lib/navigationHistoryTracker';
import { useIsMobile } from '@/lib/useIsMobile';

// Client mount for the dedicated /tasks/[id] page.
//
// All this does is render PropertyTaskDetailOverlay in `layout="page"`
// mode — i.e. full-bleed centered column instead of right-1/3 absolute
// overlay. Every interactive piece (edits, comments, attachments,
// time tracking, bin moves) is owned by the existing overlay component
// and hits the same API endpoints it always has, so we get the full
// task UX without duplicating any of the plumbing.
//
// Close behaviour: pop in-app history. This page is reachable from eleven
// places — the four dashboard windows, a property's schedule and task ledger, a
// guest message thread, the global context overlay, a push notification, and
// Slack — and closing it used to send all eleven to /tasks, which is the right
// answer for exactly one of them.
//
// The fallback is only used on a cold entry, where there is genuinely no
// history to pop (the case that made a naive router.back() unsafe here). It's
// viewport-aware because /tasks itself redirects to /?view=tasks on desktop:
// pushing /tasks there would leave the task page still sitting in history one
// step back, so the browser's own Back button would re-open the task the user
// just closed.
//
// "Open in dedicated page" affordance is suppressed in this mode by
// PropertyTaskDetailOverlay itself — we're already on the page.
export function TaskDetailRoute({ task }: { task: OverlayTaskInput }) {
  const goBack = useBackNavigation();
  const isMobile = useIsMobile();

  return (
    <PropertyTaskDetailOverlay
      task={task}
      onClose={() => goBack(isMobile === false ? '/?view=tasks' : '/tasks')}
      layout="page"
    />
  );
}
