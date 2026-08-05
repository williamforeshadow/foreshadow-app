import { NextRequest, NextResponse } from 'next/server';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { runAgent, type AgentActor, WRITE_TOOL_NAMES } from '@/src/agent/runAgent';
import { applyBackstops } from '@/src/agent/backstops';
import { extractPendingActionIds } from '@/src/server/agent/slackConfirmationBlocks';
import { setPendingActionFollowup } from '@/src/server/agent/pendingActions';
import {
  formatInboundFilesForAgent,
  listRecentInboundFiles,
  loadInboundFilesForUser,
} from '@/src/server/agent/inboundFiles';
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
  let inboundFileIds: string[] = [];
  try {
    const body = await req.json();
    prompt = body?.prompt;
    // Files the user attached to THIS message, staged earlier by
    // /api/agent/attachments. Ids only — ownership is re-checked below, so a
    // forged id buys nothing. Tolerant of junk: a malformed entry is dropped
    // rather than failing the whole message.
    if (Array.isArray(body?.inbound_file_ids)) {
      inboundFileIds = body.inbound_file_ids.filter(
        (v: unknown): v is string => typeof v === 'string' && v.length > 0,
      );
    }
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

  // Uploaded-file context, mirroring what the Slack route builds from a
  // message's files[]. Two sources, one block: the files attached to this
  // message, then anything the user staged recently and hasn't filed yet — so
  // "actually, put it on the Maple task instead" still resolves a turn later.
  //
  // The model only ever sees names, types and sizes here. Bytes stay in the
  // staging bucket until a commit tool moves them.
  const attachedFiles = await loadInboundFilesForUser({
    ids: inboundFileIds,
    appUserId: userId,
    source: 'web',
  });
  const attachedIds = new Set(attachedFiles.map((f) => f.id));
  const carryForward = (
    await listRecentInboundFiles({ appUserId: userId, source: 'web' })
  ).filter((f) => !attachedIds.has(f.id));
  const filesBlock = formatInboundFilesForAgent(
    [...attachedFiles, ...carryForward],
    'web',
  );
  const contextBlocks = filesBlock ? [filesBlock] : undefined;

  await supabase.from('ai_chat_messages').insert({
    user_id: userId,
    role: 'user',
    content: prompt,
    ...(attachedFiles.length > 0
      ? {
          metadata: {
            inbound_files: attachedFiles.map((f) => ({
              id: f.id,
              name: f.name,
              file_type: f.file_type,
            })),
          },
        }
      : {}),
  });

  try {
    // db: the user's session-bound client — RLS enforces org isolation on
    // every tool query at the database layer.
    const result = await runAgent({
      history,
      prompt,
      clientTz,
      actor,
      orgId,
      db: userDb,
      contextBlocks,
    });

    // Durable confirmation buttons: if any preview tools registered pending
    // actions this turn, hand the FULL list to the client so the single
    // Confirm/Cancel pair below the message commits (or cancels) every
    // preview from the turn atomically. Suppress entirely when a commit
    // tool already succeeded in the same turn — the write is done, so a
    // button would double-commit.
    //
    // Resolved BEFORE the backstops because the phantom-button mask needs the
    // post-suppression list: it asks "will a button actually render?", and a
    // turn that already committed answers no.
    const committedThisTurn = result.toolCalls.some(
      (c) =>
        WRITE_TOOL_NAMES.has(c.name) &&
        !c.name.startsWith('preview_') &&
        c.output.ok === true,
    );
    const allPendingActionIds = extractPendingActionIds(result.toolCalls);
    const pendingActionIds = committedThisTurn ? [] : allPendingActionIds;

    // Backstops: swap in a safe message when the model claimed a side-effect
    // that no write tool produced, or pointed at a Confirm button this turn
    // never created. Both flags are persisted in metadata so reviewers can
    // spot masked rows quickly. (The read-claim mask was removed — see
    // backstops.ts for the rationale.)
    const masked = applyBackstops(result.text, result.toolCalls, {
      prompt,
      pendingActionIds,
    });
    if (masked.writeMasked) {
      console.warn('[agent] masked hallucinated write claim', {
        user_id: userId,
        prompt,
        original: masked.originalIfMasked,
      });
    }
    if (masked.buttonMasked) {
      console.warn('[agent] masked phantom confirm-button claim', {
        user_id: userId,
        prompt,
        original: masked.originalIfMasked,
      });
    }
    const finalText = masked.text;

    // Attach any follow-up the model registered (declare_followup) to the
    // bundle, so /api/agent/confirm can finish the plan on the same click
    // instead of making the user ask again. Depth 0: this turn came from a
    // real user message.
    await setPendingActionFollowup(pendingActionIds, result.followup, 0);

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
          ...(masked.buttonMasked ? { masked_button_claim: true } : {}),
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
