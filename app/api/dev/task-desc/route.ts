import { NextResponse } from 'next/server';
import { createTask } from '@/src/server/tasks/createTask';
import { previewUpdateTask, updateTask } from '@/src/server/tasks/updateTask';
import { getTaskById } from '@/src/server/tasks/getTaskById';

// Dev-only harness for task description handling.
//
// Task descriptions have now produced the same class of bug three times: an
// edit compared against a truncated preview looked like no change, while the
// write still happened. This route exposes create / preview / commit / read so
// scripts/taskDescriptionEval.mjs can prove, against a real database, that a
// description edit is both DETECTED and STORED with the structure it claims.
//
// No auth and no org scoping on purpose — it drives the services directly,
// which is exactly why it must never be reachable in production.

export const maxDuration = 60;

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'The task description harness is disabled in production.' },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(req: Request) {
  const blocked = devGuard();
  if (blocked) return blocked;

  let body: { mode?: string; input?: unknown; orgId?: string; taskId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    switch (body.mode) {
      case 'create':
        return NextResponse.json(
          await createTask(body.input, {
            actor: { user_id: null },
            orgId: body.orgId!,
          }),
        );
      case 'preview_update':
        return NextResponse.json(await previewUpdateTask(body.input, body.orgId!));
      case 'commit_update':
        return NextResponse.json(
          await updateTask(body.input, { actor: { user_id: null }, orgId: body.orgId! }),
        );
      case 'read':
        return NextResponse.json(await getTaskById(body.taskId!));
      default:
        return NextResponse.json(
          { error: 'mode must be create | preview_update | commit_update | read' },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        threw: true,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 200 },
    );
  }
}
