import { notFound } from 'next/navigation';
import { getTaskById } from '@/src/server/tasks/getTaskById';
import { TaskDetailRoute } from '@/components/tasks/TaskDetailRoute';
import type { OverlayTaskInput } from '@/components/properties/tasks/PropertyTaskDetailOverlay';

// /tasks/[id] — canonical, deep-linkable task page.
//
// This is a server component. Why SSR rather than a client-side fetch?
//
//   1. Reliability from external surfaces. The legacy form
//      `/?view=tasks&task=<uuid>` depended on the dashboard SPA shell
//      booting, the auth gate completing, ReservationViewerProvider
//      mounting, TaskDeepLinkSync running, and /api/all-tasks/[id]
//      returning — all client-side, all racey on mobile webviews. Slack
//      iOS in particular regularly lost the deep-link payload across the
//      auth round-trip, leaving users on a blank dashboard. Doing the
//      fetch on the server means the HTML response already contains the
//      task body — nothing to bootstrap, nothing to lose.
//
//   2. notFound() short-circuits cleanly. A deleted task or a malformed
//      uuid renders Next.js's 404 page from the same response, instead
//      of waiting for a client-side fetch error to surface.
//
//   3. Permissions land here once we add them. Today there are no
//      per-user gates (we're explicitly punting on that), but server-
//      side fetch means the eventual auth check is a single
//      well-defined boundary rather than every consumer of
//      /api/all-tasks/[id].
//
// Data is then handed off to a client component (`TaskDetailRoute`) for
// the interactive parts — comments, attachments, edits, etc. — which all
// hit existing API endpoints directly.
//
// The TaskByIdRow → OverlayTaskInput shape conversion happens inline:
// every field maps 1:1 except `form_metadata`, which TaskByIdRow types
// as `unknown` (Supabase JSON column) and the overlay narrows to
// `Record<string, unknown> | null`. Anything that isn't a plain object
// becomes null, matching what the existing client-side fetch path would
// produce.
export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getTaskById(id);

  if (!result.ok) {
    if (result.reason === 'invalid_id' || result.reason === 'not_found') {
      notFound();
    }
    // 'error' = Supabase / database failure. Surface as 404 too — there's
    // no useful UI for a transient DB blip and the original error is
    // logged in the server log via getTaskById's caller path. A retry
    // simply reloads the page.
    notFound();
  }

  const task: OverlayTaskInput = {
    task_id: result.task.task_id,
    reservation_id: result.task.reservation_id,
    property_id: result.task.property_id,
    property_name: result.task.property_name,
    template_id: result.task.template_id,
    template_name: result.task.template_name,
    title: result.task.title,
    description: result.task.description,
    priority: result.task.priority,
    department_id: result.task.department_id,
    department_name: result.task.department_name,
    status: result.task.status,
    scheduled_date: result.task.scheduled_date,
    scheduled_time: result.task.scheduled_time,
    form_metadata: isPlainObject(result.task.form_metadata)
      ? (result.task.form_metadata as Record<string, unknown>)
      : null,
    bin_id: result.task.bin_id,
    bin_name: result.task.bin_name,
    is_binned: result.task.is_binned,
    created_at: result.task.created_at,
    updated_at: result.task.updated_at,
    assigned_users: result.task.assigned_users,
  };

  return <TaskDetailRoute task={task} />;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
