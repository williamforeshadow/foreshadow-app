import { getSupabaseServer } from '@/lib/supabaseServer';
import { createSupabaseAsUser } from '@/lib/supabaseAsUser';
import { runAgent, type AgentActor, type AgentSurface } from '@/src/agent/runAgent';
import { applyBackstops } from '@/src/agent/backstops';
import { extractPendingActionIds } from './slackConfirmationBlocks';
import {
  setPendingActionFollowup,
  type PendingActionRow,
} from './pendingActions';

// Continuing a plan after the user clicks Confirm.
//
// Confirming used to be terminal on both surfaces: the routes committed the
// bundle, posted a summary, and stopped. Work that could only happen after the
// commit — because it needs ids the commit creates — died there, and the
// operator had to send another message to get the second half of their request.
//
// When the agent registered a follow-up during the preview turn
// (declare_followup), this module replays it as a fresh agent turn once the
// commit lands. The replayed turn is an ordinary agent run: same tools, same
// preview/confirm protocol. It is NOT an escalation — a continuation that wants
// to write must preview and be confirmed like anything else.
//
// Deliberate limits:
//   - Only on a FULLY successful commit. A partial failure may mean the ids the
//     follow-up depends on don't exist, so we stop and let the user decide.
//   - Only up to MAX_CONTINUATION_DEPTH, so preview → confirm → preview cannot
//     cycle forever if a plan keeps declaring more work.
//   - Never on cancel.

/**
 * How many confirm-triggered turns may chain. 2 allows a three-phase plan
 * (initial turn + two continuations), past anything a real request needs, while
 * still terminating.
 */
export const MAX_CONTINUATION_DEPTH = 2;

export interface ContinuationResult {
  /** The agent's reply for the continuation turn. */
  text: string;
  /** Pending actions the continuation registered; may be empty. */
  pendingActionIds: string[];
}

interface ContinuationInputs {
  /** The bundle the user just confirmed, in registration order. */
  rows: PendingActionRow[];
  /** Per-action outcome text, same order, as shown to the user. */
  results: Array<{ ok: boolean; text: string }>;
  surface: AgentSurface;
}

/**
 * Decide whether a confirmed bundle should continue, and run it if so.
 * Returns null whenever there's nothing to do — the common case, and cheap:
 * the checks are all in-memory on rows the caller already loaded.
 */
export async function maybeRunContinuation({
  rows,
  results,
  surface,
}: ContinuationInputs): Promise<ContinuationResult | null> {
  if (rows.length === 0) return null;

  // Every action must have committed. The follow-up was written assuming the
  // whole plan landed; running it against a half-applied bundle risks acting on
  // ids that were never created.
  if (results.some((r) => !r.ok)) return null;

  const instruction = rows.find((r) => r.followup_instruction)?.followup_instruction;
  if (!instruction) return null;

  const depth = Math.max(...rows.map((r) => r.continuation_depth ?? 0));
  if (depth >= MAX_CONTINUATION_DEPTH) {
    console.warn('[agent continuation] depth cap reached; not continuing', {
      depth,
      actionIds: rows.map((r) => r.id),
    });
    return null;
  }

  const requesterId = rows[0].requester_app_user_id;
  const orgId = rows[0].org_id;
  if (!requesterId || !orgId) return null;

  const supabase = getSupabaseServer();
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name, role, auth_user_id')
    .eq('id', requesterId)
    .maybeSingle();
  if (!userRow) return null;

  const actor: AgentActor = {
    appUserId: userRow.id as string,
    name: (userRow.name as string) || 'Unknown user',
    role: userRow.role as AgentActor['role'],
  };

  // Same RLS-governed client the original turn ran under, so the continuation
  // cannot reach further than the turn that spawned it.
  let db;
  try {
    const authUserId = (userRow.auth_user_id as string | null) ?? null;
    db = authUserId ? createSupabaseAsUser(authUserId) : undefined;
  } catch (err) {
    console.warn('[agent continuation] could not mint user client; using service', { err });
    db = undefined;
  }

  // The continuation turn sees what actually committed, then the instruction
  // its past self left. Framed as a system-style note rather than a user
  // message so the model doesn't mistake it for something the operator typed.
  const committed = results.map((r) => `- ${r.text}`).join('\n');
  const prompt = [
    'AUTOMATIC CONTINUATION — the user pressed Confirm and every action committed.',
    'They have NOT sent a new message; you are finishing the plan you registered earlier.',
    '',
    'What just committed:',
    committed,
    '',
    'The step you registered to do next:',
    instruction,
    '',
    'Carry it out now. Resolve any ids you need from the results above or with the',
    'appropriate find_* tool — never guess one. If it needs a write, preview it as',
    'usual so the user gets a fresh Confirm. If it turns out nothing is left to do,',
    'or the results show the premise no longer holds, say so in one short sentence',
    'and stop — do not invent extra work.',
  ].join('\n');

  const result = await runAgent({
    history: [],
    prompt,
    surface,
    actor,
    orgId,
    db,
    ...(surface === 'slack' && rows[0].slack_channel_id
      ? {
          slack: {
            teamId: rows[0].slack_team_id ?? undefined,
            channelId: rows[0].slack_channel_id,
            threadTs: rows[0].slack_thread_ts ?? undefined,
            messageTs: rows[0].slack_message_ts ?? undefined,
            userId: rows[0].slack_user_id ?? '',
          },
        }
      : {}),
  });

  // Extracted before the backstops so the phantom-button mask knows whether
  // this continuation actually staged anything. A continuation that finishes
  // the plan outright registers no ids and needs no button; one that previews
  // further writes gets its own Confirm/Cancel pair from this list.
  const pendingActionIds = extractPendingActionIds(result.toolCalls);
  const masked = applyBackstops(result.text, result.toolCalls, {
    prompt,
    pendingActionIds,
  });

  // Carry the depth forward (+1) onto anything this turn queued, and record any
  // further follow-up it declared. This is what makes the cap actually bind.
  await setPendingActionFollowup(
    pendingActionIds,
    result.followup,
    depth + 1,
  );

  return { text: masked.text, pendingActionIds };
}
