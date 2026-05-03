import { NextResponse } from 'next/server';
import { getTaskById } from '@/src/server/tasks/getTaskById';

// GET /api/all-tasks/[id]
//
// Single-task lookup, shaped like a row from GET /api/all-tasks. Used by
// ReservationViewerProvider's deep-link handler to resolve a `?task=<uuid>`
// query param into the OverlayTaskInput the global task overlay expects.
//
// We deliberately don't go through /api/all-tasks?id=... because it does an
// in-memory scan over the entire ledger; this endpoint indexes by primary
// key, returns 404 cleanly when the id is bogus or the row was deleted, and
// keeps the client deep-link path snappy.
//
// The actual query lives in src/server/tasks/getTaskById.ts so the Slack
// link-unfurl handler can reuse the exact same shape without HTTP-looping
// back through this route.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await getTaskById(id);

  if (!result.ok) {
    if (result.reason === 'invalid_id') {
      return NextResponse.json(
        { error: 'Task id is required' },
        { status: 400 },
      );
    }
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: result.task });
}
