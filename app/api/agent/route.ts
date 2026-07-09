import { NextRequest, NextResponse } from 'next/server';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { runAgent, type AgentActor, WRITE_TOOL_NAMES } from '@/src/agent/runAgent';
import { applyBackstops } from '@/src/agent/backstops';
import { extractPendingActionIds } from '@/src/server/agent/slackConfirmationBlocks';
import type { TaskRow } from '@/src/agent/tools/findTasks';

// POST /api/agent
//
// Tool-calling chat agent. The model never writes SQL — it answers data
// questions by invoking tools registered in src/agent/tools. This route is a
// thin shell that handles HTTP, conversation memory, and persistence; all
// LLM + tool dispatch lives in src/agent/runAgent. Hallucination backstops
// live in src/agent/backstops and are shared with the Slack route.

const MEMORY_WINDOW = 15; // user+assistant message pairs to replay as history

interface ChatMessageRow {
  role: string;
  content: string;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    return NextResponse.json(
      { error: 'Server configuration error: Missing API key' },
      { status: 500 },
    );
  }

  let prompt: string;
  let clientTz: string | undefined;
  try {
    const body = await req.json();
    prompt = body?.prompt;
    // NOTE: body.user_id is intentionally IGNORED. The acting user comes from
    // the verified Supabase session below — trusting a client-supplied id let
    // any caller impersonate any user (and thereby scope the agent to any
    // org). Fail closed instead.
    // Browser-supplied IANA tz string (e.g. "America/Los_Angeles"). Optional;
    // runAgent falls back to UTC when missing or invalid. Keep this tolerant —
    // we don't want a malformed tz to fail the whole request.
    if (typeof body?.client_tz === 'string' && body.client_tz.length > 0) {
      clientTz = body.client_tz;
    }
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid prompt' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Verified session identity + org + RLS-scoped client. 401/403 when there is
  // no signed-in, org-linked user — the agent never runs unauthenticated.
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { supabase: userDb, appUser, orgId } = authCtx;
  const userId = appUser.id;

  const supabase = getSupabaseServer();

  // Pull recent conversation history. We persist only final assistant text
  // (no tool_use / tool_result blocks) so the history we replay is plain
  // text on both sides — the agent will re-invoke tools as needed.
  // Memory stays on the service client but is keyed by the VERIFIED user id.
  let history: MessageParam[] = [];
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MEMORY_WINDOW * 2);

  if (!error && data) {
    history = (data as ChatMessageRow[])
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
  }

  const actor: AgentActor = {
    appUserId: appUser.id,
    name: appUser.name || 'Unknown user',
    role: appUser.role,
  };

  await supabase.from('ai_chat_messages').insert({
    user_id: userId,
    role: 'user',
    content: prompt,
  });

  try {
    // db: the user's session-bound client — RLS enforces org isolation on
    // every tool query at the database layer.
    const result = await runAgent({ history, prompt, clientTz, actor, orgId, db: userDb });

    // Write-claim backstop: if the model claimed a side-effect happened
    // but no write tool succeeded, swap in a safe message before the user
    // sees it. The flag is persisted in metadata so reviewers can spot
    // masked rows quickly. (The read-claim mask was removed — see
    // backstops.ts for the rationale.)
    const masked = applyBackstops(result.text, result.toolCalls, { prompt });
    if (masked.writeMasked) {
      console.warn('[agent] masked hallucinated write claim', {
        user_id: userId,
        prompt,
        original: masked.originalIfMasked,
      });
    }
    const finalText = masked.text;

    // Durable confirmation buttons: if any preview tools registered pending
    // actions this turn, hand the FULL list to the client so the single
    // Confirm/Cancel pair below the message commits (or cancels) every
    // preview from the turn atomically. Suppress entirely when a commit
    // tool already succeeded in the same turn — the write is done, so a
    // button would double-commit.
    const committedThisTurn = result.toolCalls.some(
      (c) =>
        WRITE_TOOL_NAMES.has(c.name) &&
        !c.name.startsWith('preview_') &&
        c.output.ok === true,
    );
    const allPendingActionIds = extractPendingActionIds(result.toolCalls);
    const pendingActionIds = committedThisTurn ? [] : allPendingActionIds;

    if (userId) {
      await supabase.from('ai_chat_messages').insert({
        user_id: userId,
        role: 'assistant',
        content: finalText,
        // Store a per-call trace of which tools fired, what input the model
        // passed, and the outcome envelope (meta on success, error on
        // failure). We deliberately drop `data` to keep rows small but keep
        // everything we need to diagnose hallucinations and silent empties
        // after the fact.
        metadata: {
          tool_calls: result.toolCalls.map((c) => {
            const base = { name: c.name, input: c.input, ok: c.output.ok };
            return c.output.ok
              ? { ...base, meta: c.output.meta }
              : { ...base, error: c.output.error };
          }),
          ...(masked.writeMasked ? { masked_write_claim: true } : {}),
        },
      });
    }

    // Surface the structured task rows returned by any find_tasks call this
    // turn so the chat can render them as kanban-style cards. Deduped by
    // task_id; the client picks which to show based on the tasks the answer
    // actually links to.
    const taskCardMap = new Map<string, TaskRow>();
    for (const c of result.toolCalls) {
      if (c.name === 'find_tasks' && c.output.ok === true) {
        const rows = (c.output.data ?? []) as TaskRow[];
        for (const r of rows) {
          if (r && typeof r.task_id === 'string') {
            taskCardMap.set(r.task_id, r);
          }
        }
      }
    }

    return NextResponse.json({
      answer: finalText,
      tool_calls: result.toolCalls,
      pending_action_ids: pendingActionIds,
      tasks: Array.from(taskCardMap.values()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Agent error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
