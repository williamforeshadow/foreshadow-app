import { NextResponse } from 'next/server';
import { getTaskById } from '@/src/server/tasks/getTaskById';

// GET /api/all-tasks/[id]
//
// Single-task lookup, shaped like a row from GET /api/all-tasks.
//
// Status: no first-party caller as of the /tasks/[id] migration. The
// dedicated task page (app/tasks/[id]/page.tsx) is a server component
// that calls getTaskById() directly, and the Slack unfurl handler does
// the same — no HTTP round-trip needed in either path. We keep this
// endpoint in place because (a) external scripts / future SDK consumers
// may legitimately want a JSON shape over HTTP, (b) it's a stable surface
// the agent's /api integration tests can hit, and (c) removing it would
// break any in-flight links the front-end might still hold from before
// the migration.
//
// We deliberately don't go through /api/all-tasks?id=... because it does
// an in-memory scan over the entire ledger; this endpoint indexes by
// primary key and returns 404 cleanly when the id is bogus or the row
// was deleted.
//
// The actual query lives in src/server/tasks/getTaskById.ts so this
// route, the new task page, and the Slack link-unfurl handler all share
// the same shape.
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
