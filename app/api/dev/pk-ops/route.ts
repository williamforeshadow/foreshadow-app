import { NextResponse } from 'next/server';
import {
  previewPropertyKnowledgeOperations,
  commitPropertyKnowledgeOperations,
} from '@/src/server/properties/propertyKnowledgeOperations';
import {
  previewPropertyKnowledgeBatch,
  commitPropertyKnowledgeBatch,
} from '@/src/server/properties/propertyKnowledgeWriteBatch';

// Dev-only harness for the Property Knowledge operations services.
//
// The repo has no test runner, and a plain .mjs script cannot import these
// modules (TypeScript, `@/` path aliases). This route is the seam: it exposes
// preview/commit verbatim so scripts/propertyKnowledgeOpsEval.mjs can drive real
// scenarios against a real database inside the real Next runtime, then assert on
// the rows that came out.
//
// It performs NO auth and NO org scoping on purpose — it is testing the
// org-blind services directly, which is exactly why it must never be reachable
// in production.

export const maxDuration = 120;

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'The Property Knowledge operations harness is disabled in production.' },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(req: Request) {
  const blocked = devGuard();
  if (blocked) return blocked;

  let body: { mode?: string; kind?: string; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mode, kind, input } = body;
  if (mode !== 'preview' && mode !== 'commit') {
    return NextResponse.json({ error: 'mode must be "preview" or "commit"' }, { status: 400 });
  }
  if (kind !== 'single' && kind !== 'batch') {
    return NextResponse.json({ error: 'kind must be "single" or "batch"' }, { status: 400 });
  }

  try {
    if (kind === 'single') {
      const result =
        mode === 'preview'
          ? await previewPropertyKnowledgeOperations(input)
          : await commitPropertyKnowledgeOperations(input);
      return NextResponse.json(result);
    }
    const result =
      mode === 'preview'
        ? await previewPropertyKnowledgeBatch(input)
        : await commitPropertyKnowledgeBatch(input);
    return NextResponse.json(result);
  } catch (err) {
    // Surface the throw rather than a framework 500 — the eval driver needs the
    // message to tell "this scenario is wrong" from "this code is broken".
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
