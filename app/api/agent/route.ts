import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  appendMessage,
  loadReplayedHistory,
  resolveWebSession,
  WEB_HISTORY_LIMIT,
} from '@/src/server/agent/memory';
import { renderInboundFilesAsMedia } from '@/src/server/agent/inboundFileVision';
import { maybeTitleSession } from '@/src/server/agent/sessions';
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
import { loadProposedTaskCards } from '@/src/server/agent/proposedTaskCards';

// POST /api/agent
//
// Tool-calling chat agent. The model never writes SQL — it answers data
// questions by invoking tools registered in src/agent/tools. This route is a
// thin shell that handles HTTP, conversation memory, and persistence; all
// LLM + tool dispatch lives in src/agent/runAgent. Hallucination backstops
// live in src/agent/backstops and are shared with the Slack route.
//
// Memory is scoped to a WEB session (src/server/agent/memory.ts), not to the
// user. Slack runs its own sessions, so a conversation started there no longer
// bleeds into this panel.

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
  let requestedSessionId: string | undefined;
  let wantsNewSession = false;
  try {
    const body = await req.json();
    prompt = body?.prompt;
    // Which conversation to continue. Verified against the caller before use,
    // so a forged id reaches nobody else's chat.
    if (typeof body?.session_id === 'string' && body.session_id.length > 0) {
      requestedSessionId = body.session_id;
    }
    // "New chat", as opposed to a client that just doesn't know its id yet.
    // Only the first message of a fresh panel carries this; every message
    // after it carries the id that came back on this one.
    if (body?.new_session === true) {
      wantsNewSession = true;
    }
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

  // The conversation this turn belongs to: the id the panel sent, a brand new
  // one when they pressed "New chat", or their most recent otherwise.
  const sessionId = await resolveWebSession({
    appUserId: userId,
    orgId,
    sessionId: requestedSessionId,
    forceNew: wantsNewSession,
  });

  // Pull recent conversation history. We persist only final assistant text
  // (no tool_use / tool_result blocks) so the history we replay is plain
  // text on both sides — the agent will re-invoke tools as needed.
  const history = await loadReplayedHistory(sessionId, WEB_HISTORY_LIMIT);

  // Name the session after the message that opened it. No-ops once it has a
  // title, so a rename the user typed is never clobbered.
  await maybeTitleSession(sessionId, prompt);

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

  // What the model actually looks at this turn: the files on THIS message,
  // plus any carry-forward file the history has no record of showing.
  //
  // The exclusion matters. A carry-forward file that history already replayed
  // is on screen at the turn it arrived on — rendering it again here would put
  // the same photo in the prompt twice and make "Image 2" ambiguous. But a file
  // staged and never sent, or sent on a turn that has since aged past the media
  // cap, has never been seen at all, so it gets promoted into this turn.
  const orphaned = carryForward.filter((f) => !history.replayedFileIds.has(f.id));
  const render = await renderInboundFilesAsMedia([...attachedFiles, ...orphaned], {
    startLabel: history.nextLabel,
  });

  const filesBlock = formatInboundFilesForAgent(
    [...attachedFiles, ...carryForward],
    'web',
    render,
  );
  const contextBlocks = filesBlock ? [filesBlock] : undefined;

  await appendMessage({
    sessionId,
    appUserId: userId,
    surface: 'web',
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
      history: history.messages,
      historyHasMedia: history.hasMedia,
      prompt,
      promptMedia: render.blocks,
      clientTz,
      actor,
      orgId,
      db: userDb,
      contextBlocks,
      sessionId: sessionId ?? undefined,
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
        // A proposal is durable but INERT — it grounds write-claim language
        // without committing anything, so it must not suppress the Confirm
        // buttons of other previews staged in the same turn.
        c.name !== 'propose_task' &&
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

    // Durable task proposals registered this turn (propose_task). Their ids
    // are persisted on the assistant message so a reload re-renders the cards;
    // the shaped card data rides the response for immediate rendering. A
    // superseded proposal (replaces_proposal_id) is dropped from earlier
    // messages by the rehydration path, which only returns live rows.
    const proposedTaskIds: string[] = [];
    for (const c of result.toolCalls) {
      if (c.name === 'propose_task' && c.output.ok === true) {
        const id = (c.output.data as { proposal_id?: unknown } | null)
          ?.proposal_id;
        if (typeof id === 'string' && id.length > 0) proposedTaskIds.push(id);
      }
    }
    const proposedTaskCards = await loadProposedTaskCards(
      userDb,
      proposedTaskIds,
    );

    await appendMessage({
      sessionId,
      appUserId: userId,
      surface: 'web',
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
        // Needed to put the Confirm/Cancel pair back after a reload. Without
        // it a refresh mid-preview would strand a staged write with no way to
        // commit it. Rehydration only re-renders buttons for actions that are
        // still pending, so recording them on every turn is safe.
        ...(pendingActionIds.length > 0
          ? { pending_action_ids: pendingActionIds }
          : {}),
        // Same reload story as pending_action_ids, but for proposal cards.
        ...(proposedTaskIds.length > 0
          ? { proposed_task_ids: proposedTaskIds }
          : {}),
      },
    });

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
      proposed_tasks: proposedTaskCards,
      // Which conversation this landed in. Phase 2's switcher echoes it back on
      // the next request; harmless for the current client, which ignores it.
      session_id: sessionId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Agent error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
