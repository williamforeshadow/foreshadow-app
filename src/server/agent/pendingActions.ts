import { getSupabaseServer } from '@/lib/supabaseServer';
import { taskUrl } from '@/src/lib/links';
import { createTask, type CreateTaskInput } from '@/src/server/tasks/createTask';
import { updateTask } from '@/src/server/tasks/updateTask';
import { deleteTask } from '@/src/server/tasks/deleteTask';
import { createTasksBatch } from '@/src/server/tasks/createTasksBatch';
import { updateTasksBatch } from '@/src/server/tasks/updateTasksBatch';
import { createBin } from '@/src/server/bins/createBin';
import { addComment } from '@/src/server/comments/addComment';
import {
  commitPropertyKnowledgeOperations,
  type PropertyKnowledgeOperationsCommitResult,
  type PropertyKnowledgeOperationsInput,
} from '@/src/server/properties/propertyKnowledgeOperations';
import {
  commitPropertyKnowledgeBatch,
  type PropertyKnowledgeBatchInput,
} from '@/src/server/properties/propertyKnowledgeWriteBatch';
import {
  commitPropertyContactBatch,
  type PropertyContactBatchInput,
} from '@/src/server/properties/propertyContactBatch';
import {
  commitAddCommentsBatch,
  type AddCommentsBatchInput,
} from '@/src/server/comments/addCommentsBatch';
import { upsertPropertyContact } from '@/src/server/properties/upsertPropertyContact';
import { deletePropertyContact } from '@/src/server/properties/deletePropertyContact';
import {
  commitSlackFileAttachment,
  type SlackFileAttachmentInput,
} from '@/src/server/slack/attachInboundFile';
import type { ToolContext } from '@/src/agent/tools/types';

export const AGENT_CONFIRM_ACTION_ID = 'agent_confirm_action';
export const AGENT_CANCEL_ACTION_ID = 'agent_cancel_action';

const PENDING_TTL_MS = 5 * 60 * 1000;

export type PendingActionKind =
  | 'create_task'
  | 'update_task'
  | 'delete_task'
  | 'create_tasks_batch'
  | 'update_tasks_batch'
  | 'create_bin'
  | 'add_comment'
  | 'add_comments_batch'
  | 'property_knowledge_write'
  | 'property_knowledge_batch'
  | 'property_contact_batch'
  | 'property_contact_upsert'
  | 'property_contact_delete'
  | 'slack_file_attachment';

export interface SlackPendingActionContext {
  teamId?: string;
  channelId: string;
  threadTs?: string;
  messageTs?: string;
  userId: string;
}

interface CreateTaskPendingInput {
  input: CreateTaskInput;
  attachment_inbound_file_ids?: string[];
}

interface PropertyKnowledgePendingInput {
  input: PropertyKnowledgeOperationsInput;
}

interface PropertyKnowledgeBatchPendingInput {
  input: PropertyKnowledgeBatchInput;
}

interface PropertyContactBatchPendingInput {
  input: PropertyContactBatchInput;
}

interface AddCommentsBatchPendingInput {
  input: AddCommentsBatchInput;
}

interface SlackFilePendingInput {
  input: SlackFileAttachmentInput;
}

interface GenericPendingInput {
  input: unknown;
}

export interface PendingActionRow {
  id: string;
  surface: 'slack' | 'web';
  action_kind: PendingActionKind;
  status: 'pending' | 'processing' | 'committed' | 'cancelled' | 'failed' | 'expired';
  /**
   * Owning org. Derived at insert time from requester_app_user_id via the
   * derive_org_id trigger, so it is authoritative for scoping the commit —
   * the executor stamps it onto the created row(s) rather than re-resolving.
   * Null only when the row had no requester (fails closed on commit).
   */
  org_id: string | null;
  requester_app_user_id: string | null;
  slack_team_id: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  slack_message_ts: string | null;
  slack_user_id: string | null;
  canonical_input: unknown;
  preview: unknown;
  result: unknown;
  error_message: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  /**
   * Dependent step to replay once this whole bundle commits, declared by the
   * agent via declare_followup during the preview turn. Null for the ordinary
   * case where confirming finishes the job.
   */
  followup_instruction: string | null;
  /**
   * How many confirm-triggered continuations preceded this row. 0 for actions
   * previewed from a real user message. Bounded in continuation.ts so a plan
   * that keeps declaring follow-ups cannot cycle forever.
   */
  continuation_depth: number;
}

export interface CreatePendingActionArgs {
  kind: PendingActionKind;
  surface: 'slack' | 'web';
  requesterAppUserId?: string | null;
  /** Required when surface === 'slack'; omitted for web rows. */
  slack?: SlackPendingActionContext;
  canonicalInput: unknown;
  preview: unknown;
}

export interface PendingExecutionResult {
  ok: boolean;
  status: 'committed' | 'failed' | 'expired' | 'cancelled';
  text: string;
  result?: unknown;
  error?: string;
}

function expiresAt() {
  return new Date(Date.now() + PENDING_TTL_MS).toISOString();
}

function asRows(data: unknown): PendingActionRow[] {
  return (data ?? []) as PendingActionRow[];
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Uppercase the first character.
 *
 * These result strings used to open with a fixed "Done - " prefix, so an
 * interpolated verb ("created", "cleared", "saved") could stay lowercase.
 * Without the prefix the verb usually leads the sentence and has to be
 * capitalized where it's used. Replaces the hand-written
 * `verb === 'cleared' ? 'Cleared' : 'Updated'` ternaries that were already
 * doing this in the failure branches.
 */
function sentenceCase(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function slackTaskLink(taskId: string, title: string) {
  return `<${taskUrl(taskId)}|${title || 'Task'}>`;
}

export async function createPendingAction(
  args: CreatePendingActionArgs,
): Promise<string | null> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('agent_pending_actions')
    .insert({
      surface: args.surface,
      action_kind: args.kind,
      status: 'pending',
      requester_app_user_id: args.requesterAppUserId ?? null,
      slack_team_id: args.slack?.teamId ?? null,
      slack_channel_id: args.slack?.channelId ?? null,
      slack_thread_ts: args.slack?.threadTs ?? null,
      slack_message_ts: args.slack?.messageTs ?? null,
      slack_user_id: args.slack?.userId ?? null,
      canonical_input: args.canonicalInput,
      preview: args.preview,
      expires_at: expiresAt(),
    })
    .select('id')
    .maybeSingle();

  if (error || !data?.id) {
    console.error('[agent pending actions] create failed', { error });
    return null;
  }
  return data.id as string;
}

/**
 * Register a pending action from a preview tool, picking up surface and
 * identity from the tool context. Returns the new action id, or null when
 * there is no durable surface to attach it to (e.g. an anonymous web call
 * with no resolved actor). Preview tools call this instead of branching on
 * surface themselves.
 */
export async function maybeCreatePendingAction(
  ctx: ToolContext,
  args: {
    kind: PendingActionKind;
    canonicalInput: unknown;
    preview: unknown;
  },
): Promise<string | null> {
  if (ctx.surface === 'slack' && ctx.slack) {
    return createPendingAction({
      kind: args.kind,
      surface: 'slack',
      requesterAppUserId: ctx.actor?.appUserId ?? null,
      slack: ctx.slack,
      canonicalInput: args.canonicalInput,
      preview: args.preview,
    });
  }
  if (ctx.surface === 'web' && ctx.actor) {
    return createPendingAction({
      kind: args.kind,
      surface: 'web',
      requesterAppUserId: ctx.actor.appUserId,
      canonicalInput: args.canonicalInput,
      preview: args.preview,
    });
  }
  return null;
}

/**
 * Surface-aware access check: only the person who requested an action may
 * confirm or cancel it. Slack rows are keyed by slack_user_id; web rows by
 * requester_app_user_id.
 */
function isAuthorizedActor(
  row: PendingActionRow,
  ids: { slackUserId?: string; appUserId?: string },
): boolean {
  if (row.surface === 'web') {
    return (
      !!ids.appUserId &&
      !!row.requester_app_user_id &&
      row.requester_app_user_id === ids.appUserId
    );
  }
  return (
    !!ids.slackUserId &&
    !!row.slack_user_id &&
    row.slack_user_id === ids.slackUserId
  );
}

/**
 * Attach a declared follow-up (and this turn's continuation depth) to every
 * action in the bundle the user is about to confirm.
 *
 * Stamped after the fact — like setPendingActionMessageTs — because the preview
 * tools that create these rows run before the model has finished the turn, so
 * neither the follow-up nor the depth is known at insert time. Denormalizing
 * across the bundle keeps the confirm handler a single read: it commits the
 * rows it was given and finds the instruction already on them.
 */
export async function setPendingActionFollowup(
  actionIds: string[],
  followupInstruction: string | null,
  continuationDepth: number,
): Promise<void> {
  if (actionIds.length === 0) return;
  if (!followupInstruction && continuationDepth === 0) return;
  const { error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .update({
      followup_instruction: followupInstruction,
      continuation_depth: continuationDepth,
    })
    .in('id', actionIds);
  if (error) {
    console.warn('[agent pending actions] followup update failed', {
      actionIds,
      error,
    });
  }
}

export async function setPendingActionMessageTs(
  actionIds: string[],
  messageTs: string | undefined,
): Promise<void> {
  if (!messageTs || actionIds.length === 0) return;
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('agent_pending_actions')
    .update({ slack_message_ts: messageTs })
    .in('id', actionIds);
  if (error) {
    console.warn('[agent pending actions] message ts update failed', {
      actionIds,
      error,
    });
  }
}

export async function listActivePendingActions(args: {
  slackUserId: string;
  channelId: string;
  threadTs?: string;
  limit?: number;
}): Promise<PendingActionRow[]> {
  const supabase = getSupabaseServer();
  let query = supabase
    .from('agent_pending_actions')
    .select('*')
    .eq('surface', 'slack')
    .eq('status', 'pending')
    .eq('slack_user_id', args.slackUserId)
    .eq('slack_channel_id', args.channelId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 3);

  if (args.threadTs) {
    query = query.eq('slack_thread_ts', args.threadTs);
  } else {
    query = query.is('slack_thread_ts', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[agent pending actions] active query failed', { error });
    return [];
  }
  return asRows(data);
}

/**
 * Load a bundle by id, in the caller's order, skipping ids that no longer
 * exist. Read before confirming: the confirm handlers need each row's declared
 * follow-up and continuation depth, and those are stamped at preview time and
 * unchanged by the commit.
 */
export async function loadPendingActionsByIds(
  ids: string[],
): Promise<PendingActionRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .select('*')
    .in('id', ids);
  if (error) {
    console.error('[agent pending actions] bundle load failed', { ids, error });
    return [];
  }
  const byId = new Map(asRows(data).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is PendingActionRow => !!r);
}

export function isBareConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');
  return [
    'go',
    'yes',
    'yep',
    'yeah',
    'proceed',
    'confirm',
    'approved',
    'approve',
    'do it',
    'go ahead',
    'sounds good',
    'that works',
  ].includes(normalized);
}

export async function cancelPendingAction(args: {
  actionId: string;
  slackUserId?: string;
  appUserId?: string;
}): Promise<PendingExecutionResult> {
  const row = await loadPendingAction(args.actionId);
  if (!row) {
    return {
      ok: false,
      status: 'failed',
      text: 'I could not find that pending action. It may have expired.',
      error: 'not_found',
    };
  }
  if (!isAuthorizedActor(row, args)) {
    return {
      ok: false,
      status: 'failed',
      text: 'Only the person who requested this action can cancel it.',
      error: 'forbidden',
    };
  }
  if (row.status !== 'pending') {
    return alreadyHandled(row);
  }

  const now = new Date().toISOString();
  const { error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .update({
      status: 'cancelled',
      resolved_at: now,
      error_message: 'Cancelled by requester.',
    })
    .eq('id', row.id)
    .eq('status', 'pending');

  if (error) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not cancel that action: ${error.message}`,
      error: error.message,
    };
  }
  return { ok: true, status: 'cancelled', text: 'Cancelled.' };
}

export async function confirmPendingAction(args: {
  actionId: string;
  slackUserId?: string;
  appUserId?: string;
}): Promise<PendingExecutionResult> {
  const claimed = await claimPendingAction(args.actionId, {
    slackUserId: args.slackUserId,
    appUserId: args.appUserId,
  });
  if (!claimed.ok) return claimed.result;

  const execution = await executePendingAction(claimed.row);
  const finalStatus = execution.status;
  const now = new Date().toISOString();
  const { error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .update({
      status: finalStatus,
      resolved_at: now,
      result: execution.result ?? null,
      error_message: execution.error ?? null,
    })
    .eq('id', claimed.row.id);

  if (error) {
    console.error('[agent pending actions] final status update failed', {
      actionId: claimed.row.id,
      error,
    });
  }
  return execution;
}

async function loadPendingAction(id: string): Promise<PendingActionRow | null> {
  const { data, error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[agent pending actions] load failed', { id, error });
    return null;
  }
  return (data as PendingActionRow | null) ?? null;
}

async function claimPendingAction(
  actionId: string,
  ids: { slackUserId?: string; appUserId?: string },
): Promise<
  | { ok: true; row: PendingActionRow }
  | { ok: false; result: PendingExecutionResult }
> {
  const row = await loadPendingAction(actionId);
  if (!row) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'failed',
        text: 'I could not find that pending action. It may have expired.',
        error: 'not_found',
      },
    };
  }
  if (!isAuthorizedActor(row, ids)) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'failed',
        text: 'Only the person who requested this action can confirm it.',
        error: 'forbidden',
      },
    };
  }
  if (row.status !== 'pending') {
    return { ok: false, result: alreadyHandled(row) };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await getSupabaseServer()
      .from('agent_pending_actions')
      .update({
        status: 'expired',
        resolved_at: new Date().toISOString(),
        error_message: 'Confirmation expired.',
      })
      .eq('id', row.id)
      .eq('status', 'pending');
    return {
      ok: false,
      result: {
        ok: false,
        status: 'expired',
        text: 'That plan expired. Ask me again and I will rebuild it.',
        error: 'expired',
      },
    };
  }

  const { data, error } = await getSupabaseServer()
    .from('agent_pending_actions')
    .update({ status: 'processing' })
    .eq('id', row.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle();

  if (error || !data) {
    const latest = await loadPendingAction(row.id);
    return {
      ok: false,
      result: latest
        ? alreadyHandled(latest)
        : {
            ok: false,
            status: 'failed',
            text: 'That action was already handled.',
            error: 'already_handled',
          },
    };
  }

  return { ok: true, row: data as PendingActionRow };
}

function alreadyHandled(row: PendingActionRow): PendingExecutionResult {
  if (row.status === 'committed') {
    return {
      ok: true,
      status: 'committed',
      text: 'That action was already completed.',
      result: row.result,
    };
  }
  if (row.status === 'cancelled') {
    return {
      ok: false,
      status: 'cancelled',
      text: 'That action was already cancelled.',
      error: row.error_message ?? 'cancelled',
    };
  }
  if (row.status === 'expired') {
    return {
      ok: false,
      status: 'expired',
      text: 'That plan expired. Ask me again and I will rebuild it.',
      error: 'expired',
    };
  }
  return {
    ok: false,
    status: 'failed',
    text:
      row.status === 'processing'
        ? 'That action is already being processed.'
        : 'That action was already handled.',
    error: row.error_message ?? row.status,
  };
}

async function executePendingAction(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  if (row.action_kind === 'create_task') {
    return executeCreateTask(row);
  }
  if (row.action_kind === 'update_task') {
    return executeUpdateTask(row);
  }
  if (row.action_kind === 'delete_task') {
    return executeDeleteTask(row);
  }
  if (row.action_kind === 'create_tasks_batch') {
    return executeCreateTasksBatch(row);
  }
  if (row.action_kind === 'update_tasks_batch') {
    return executeUpdateTasksBatch(row);
  }
  if (row.action_kind === 'create_bin') {
    return executeCreateBin(row);
  }
  if (row.action_kind === 'add_comment') {
    return executeAddComment(row);
  }
  if (row.action_kind === 'property_knowledge_write') {
    return executePropertyKnowledgeWrite(row);
  }
  if (row.action_kind === 'property_knowledge_batch') {
    return executePropertyKnowledgeBatch(row);
  }
  if (row.action_kind === 'property_contact_batch') {
    return executePropertyContactBatch(row);
  }
  if (row.action_kind === 'add_comments_batch') {
    return executeAddCommentsBatch(row);
  }
  if (row.action_kind === 'property_contact_upsert') {
    return executePropertyContactUpsert(row);
  }
  if (row.action_kind === 'property_contact_delete') {
    return executePropertyContactDelete(row);
  }
  if (row.action_kind === 'slack_file_attachment') {
    return executeSlackFileAttachment(row);
  }
  return {
    ok: false,
    status: 'failed',
    text: 'I do not know how to commit that action yet.',
    error: 'unknown_action_kind',
  };
}

/**
 * Resolve the org a pending action must commit under. The value was derived
 * from requester_app_user_id when the row was created, so it's authoritative;
 * we only need to fail closed if it's somehow absent (parent-less row).
 */
function requireRowOrg(
  row: PendingActionRow,
  action: string,
):
  | { ok: true; orgId: string }
  | { ok: false; result: PendingExecutionResult } {
  if (!row.org_id) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'failed',
        text: `I could not ${action}: no organization is associated with this request.`,
        error: 'missing_org',
      },
    };
  }
  return { ok: true, orgId: row.org_id };
}

/**
 * Property Knowledge services are org-blind — they take a property_id and
 * write. The tool layer org-checks that id at preview time, but the id then
 * sits frozen in canonical_input until someone clicks Confirm, so the commit
 * path has to re-assert it rather than inherit the preview's word for it.
 *
 * Returns the org on success so callers keep the same shape as requireRowOrg.
 */
async function requirePropertiesInRowOrg(
  row: PendingActionRow,
  propertyIds: string[],
  action: string,
): Promise<{ ok: true; orgId: string } | { ok: false; result: PendingExecutionResult }> {
  const org = requireRowOrg(row, action);
  if (!org.ok) return org;

  const ids = Array.from(new Set(propertyIds));
  if (ids.length === 0) return org;

  const { data, error } = await getSupabaseServer()
    .from('properties')
    .select('id')
    .in('id', ids)
    .eq('org_id', org.orgId);
  if (error) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'failed',
        text: `I could not ${action}: ${error.message}`,
        error: error.message,
      },
    };
  }
  const visible = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
  if (ids.some((id) => !visible.has(id))) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'failed',
        text: `I could not ${action}: that property is not in your organization.`,
        error: 'property_not_in_org',
      },
    };
  }
  return org;
}

async function executeCreateTask(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'create the task');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as CreateTaskPendingInput;
  const result = await createTask(stored.input, {
    actor: { user_id: row.requester_app_user_id },
    orgId: org.orgId,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not create the task: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const attachments = await attachFiles(
    stored.attachment_inbound_file_ids,
    (inboundFileId) => ({
      destination: 'task_attachment',
      inbound_file_id: inboundFileId,
      task_id: result.task.task_id,
      actor_user_id: row.requester_app_user_id,
    }),
  );

  const attached = attachments.filter((a) => a.ok).length;
  const failed = attachments.filter((a) => !a.ok);
  const taskLink = slackTaskLink(result.task.task_id, result.task.title);
  const text =
    failed.length > 0
      ? `Created ${taskLink}, but ${formatCount(failed.length, 'attachment')} failed. ${failed[0].error}`
      : attached > 0
        ? `Created ${taskLink} and attached ${formatCount(attached, 'file')}.`
        : `Created ${taskLink}.`;

  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? 'committed' : 'failed',
    text,
    error: failed[0]?.error,
    result: { task: result.task, attachments },
  };
}

async function executeUpdateTask(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'update the task');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as GenericPendingInput;
  const result = await updateTask(stored.input, {
    actor: { user_id: row.requester_app_user_id },
    orgId: org.orgId,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not update the task: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const taskLink = slackTaskLink(result.task.task_id, result.task.title);
  const count = result.changes.length;
  return {
    ok: true,
    status: 'committed',
    text:
      count > 0
        ? `Updated ${taskLink} (${formatCount(count, 'change')}).`
        : `${taskLink} was already up to date.`,
    result,
  };
}

async function executeDeleteTask(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'delete the task');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as GenericPendingInput;
  const result = await deleteTask(stored.input, org.orgId);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not delete the task: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  return {
    ok: true,
    status: 'committed',
    text: `Deleted "${result.deleted.title}".`,
    result,
  };
}

async function executeCreateTasksBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'create the task batch');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as GenericPendingInput;
  const result = await createTasksBatch(stored.input, {
    actor: { user_id: row.requester_app_user_id },
    orgId: org.orgId,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not create the task batch: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const created = result.result.tasks.length;
  const failed = result.result.failures.length;
  const binText = result.result.created_bin
    ? ` Created sub-bin "${result.result.created_bin.name}".`
    : '';
  return {
    ok: failed === 0,
    status: failed === 0 ? 'committed' : 'failed',
    text:
      failed > 0
        ? `Created ${formatCount(created, 'task')}, but ${formatCount(failed, 'task')} failed. ${result.result.failures[0]?.error.message ?? ''}`.trim()
        : `Created ${formatCount(created, 'task')}.${binText}`,
    error: result.result.failures[0]?.error.message,
    result,
  };
}

async function executeUpdateTasksBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'update the task batch');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as GenericPendingInput;
  const result = await updateTasksBatch(stored.input, {
    actor: { user_id: row.requester_app_user_id },
    orgId: org.orgId,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not update the task batch: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const updated = result.result.updated.length;
  const skipped = result.result.skipped.length;
  const failed = result.result.failures.length;
  const skippedText =
    skipped > 0 ? ` ${formatCount(skipped, 'task')} already up to date.` : '';
  return {
    ok: failed === 0,
    status: failed === 0 ? 'committed' : 'failed',
    text:
      failed > 0
        ? `Updated ${formatCount(updated, 'task')}, but ${formatCount(failed, 'task')} failed. ${result.result.failures[0]?.error.message ?? ''}`.trim()
        : `Updated ${formatCount(updated, 'task')}.${skippedText}`,
    error: result.result.failures[0]?.error.message,
    result,
  };
}

async function executeCreateBin(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'create the sub-bin');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as GenericPendingInput;
  const result = await createBin(stored.input, org.orgId);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not create the sub-bin: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  return {
    ok: true,
    status: 'committed',
    text: `Created sub-bin "${result.bin.name}".`,
    result,
  };
}

async function executeAddComment(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'add the comment');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as GenericPendingInput;
  const result = await addComment(stored.input, org.orgId);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not add the comment: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  return {
    ok: true,
    status: 'committed',
    text: 'Added the comment.',
    result,
  };
}

/**
 * Translate a canonical_input written before Property Knowledge writes became
 * operation lists.
 *
 * Pending rows live 5 minutes, so at most that much traffic can straddle a
 * deploy — but a row clicked inside that window would otherwise find no
 * `operations` and throw under the user's Confirm button. Delete this once a
 * deploy cycle has passed.
 */
function adaptLegacyPropertyKnowledgeInput(
  stored: PropertyKnowledgePendingInput & {
    attachment_inbound_file_ids?: string[];
    attachment_caption?: string | null;
  },
): PropertyKnowledgeOperationsInput {
  const input = stored.input as PropertyKnowledgeOperationsInput & {
    action?: string;
    room_id?: string;
    attribute_id?: string;
    item_id?: string;
    document_id?: string;
    fields?: Record<string, unknown>;
  };
  if (Array.isArray(input.operations)) return input;

  const photos = stored.attachment_inbound_file_ids?.length
    ? {
        inbound_file_ids: stored.attachment_inbound_file_ids,
        caption: stored.attachment_caption ?? null,
      }
    : undefined;
  const fields = input.fields ?? {};
  const base = {
    property_id: input.property_id,
    actor_user_id: input.actor_user_id ?? null,
    source: input.source,
  };

  switch (input.action) {
    case 'upsert_room':
      return {
        ...base,
        operations: [
          {
            op: 'upsert_room',
            room: input.room_id
              ? { room_id: input.room_id }
              : {
                  title: String(fields.title ?? 'New room'),
                  scope: (fields.scope as 'interior' | 'exterior') ?? 'interior',
                },
            ...(photos ? { photos } : {}),
          },
        ],
      } as PropertyKnowledgeOperationsInput;
    case 'upsert_attribute':
      // The old shape addressed the room by id; there is no title to match on,
      // so the id form is the faithful translation.
      return {
        ...base,
        operations: [
          {
            op: 'upsert_attribute',
            room: { room_id: String(fields.room_id ?? '') },
            fields: Object.fromEntries(
              Object.entries(fields).filter(([k]) => k !== 'room_id'),
            ),
            ...(photos ? { photos } : {}),
          },
        ],
      } as PropertyKnowledgeOperationsInput;
    case 'upsert_access_item':
      return { ...base, operations: [{ op: 'upsert_access_item', fields }] } as PropertyKnowledgeOperationsInput;
    case 'upsert_connectivity':
      return { ...base, operations: [{ op: 'upsert_connectivity', fields }] } as PropertyKnowledgeOperationsInput;
    case 'update_document':
      return {
        ...base,
        operations: [{ op: 'update_document', document_id: input.document_id, fields }],
      } as PropertyKnowledgeOperationsInput;
    case 'delete_document':
      return {
        ...base,
        operations: [{ op: 'delete_document', document_id: input.document_id }],
      } as PropertyKnowledgeOperationsInput;
    case 'delete_room':
      return {
        ...base,
        operations: [{ op: 'delete_room', room: { room_id: input.room_id } }],
      } as PropertyKnowledgeOperationsInput;
    default:
      // delete_access_item and delete_attribute addressed a row by id that the
      // operations shape reaches by name; there is nothing faithful to build.
      return input;
  }
}

/** Fold a per-operation commit result into the one line the Confirm button shows. */
function propertyKnowledgeResultText(
  result: PropertyKnowledgeOperationsCommitResult,
): string {
  const failedOps = result.failures;
  const failedAttachments = result.results.flatMap((r) => r.attachments.filter((a) => !a.ok));
  const parts = [sentenceCase(result.summary)];
  if (failedOps.length > 0 && failedOps[0].error) {
    parts.push(failedOps[0].error.message);
  } else if (failedAttachments.length > 0 && failedAttachments[0].error) {
    parts.push(failedAttachments[0].error);
  }
  if (result.drift.length > 0) parts.push(result.drift[0].note);
  return `${parts.join('. ').replace(/\.\.$/, '.')}.`.replace(/\.\.$/, '.');
}

async function executePropertyKnowledgeWrite(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as PropertyKnowledgePendingInput;
  const input = adaptLegacyPropertyKnowledgeInput(stored);
  const org = await requirePropertiesInRowOrg(
    row,
    [input.property_id],
    'update Property Knowledge',
  );
  if (!org.ok) return org.result;
  const committed = await commitPropertyKnowledgeOperations(input);
  if (!committed.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not update Property Knowledge: ${committed.error.message}`,
      error: committed.error.message,
      result: committed,
    };
  }

  const result = committed.result;
  const landed = result.results.filter((r) => r.ok && r.mode !== 'noop').length;
  return {
    ok: result.ok,
    // Anything that landed means this row was acted on. Marking it 'failed'
    // would invite a retry that double-writes the operations that succeeded.
    status: landed > 0 || result.ok ? 'committed' : 'failed',
    text: propertyKnowledgeResultText(result),
    error: result.failures[0]?.error?.message,
    result,
  };
}

async function executePropertyKnowledgeBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as PropertyKnowledgeBatchPendingInput;
  const org = await requirePropertiesInRowOrg(
    row,
    stored.input.property_ids,
    'update Property Knowledge',
  );
  if (!org.ok) return org.result;
  const result = await commitPropertyKnowledgeBatch(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not update Property Knowledge: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  // Each property runs the operations independently, so report the split rather
  // than a single verb. The service already builds that sentence; this only adds
  // the two things the operator most wants confirmed actually happened.
  const attached = result.results.reduce(
    (n, p) => n + p.results.reduce((m, o) => m + o.attachments.filter((a) => a.ok).length, 0),
    0,
  );
  const roomsCreated = result.results.reduce(
    (n, p) =>
      n + p.results.filter((o) => o.ok && o.mode === 'create' && o.subject.type === 'room').length,
    0,
  );
  const extras = [
    roomsCreated > 0 ? `created ${formatCount(roomsCreated, 'room')}` : null,
    attached > 0 ? `attached ${formatCount(attached, 'photo')}` : null,
  ].filter(Boolean);
  const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  const landed = result.results.filter((r) => r.ok).length;

  return {
    ok: result.failures.length === 0,
    // Some properties committing means this row was acted on; a 'failed' status
    // would invite a retry that double-writes everything that already landed.
    status: landed > 0 || result.failures.length === 0 ? 'committed' : 'failed',
    text: `${sentenceCase(result.summary)}${suffix}`.replace(/\.(\s\()/, '$1'),
    error: result.failures[0]?.summary,
    result,
  };
}

async function executePropertyContactBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as PropertyContactBatchPendingInput;
  const result = await commitPropertyContactBatch(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not save the contact: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const name = stored.input.name;
  const changed = result.results.filter((r) => r.mode !== 'noop');
  const noops = result.results.length - changed.length;
  const verb = stored.input.action === 'delete' ? 'removed' : 'saved';
  const noopText = noops > 0
    ? ` ${formatCount(noops, 'property', 'properties')} needed no change.`
    : '';

  if (result.failures.length > 0) {
    const names = result.failures.map((f) => f.property_name).join(', ');
    return {
      ok: false,
      status: 'failed',
      text:
        `${sentenceCase(verb)} "${name}" on ` +
        `${formatCount(changed.length, 'property', 'properties')}, but ` +
        `${formatCount(result.failures.length, 'property', 'properties')} failed: ${names}. ` +
        `${result.failures[0].error?.message ?? ''}`.trim(),
      error: result.failures[0].error?.message,
      result,
    };
  }

  return {
    ok: true,
    status: 'committed',
    text: `${sentenceCase(verb)} "${name}" on ${formatCount(changed.length, 'property', 'properties')}.${noopText}`,
    result,
  };
}

async function executeAddCommentsBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const org = requireRowOrg(row, 'add the comments');
  if (!org.ok) return org.result;
  const stored = row.canonical_input as AddCommentsBatchPendingInput;
  const result = await commitAddCommentsBatch(stored.input, org.orgId);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not add the comments: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  if (result.failures.length > 0) {
    const titles = result.failures.map((f) => f.task_title ?? f.task_id).join(', ');
    return {
      ok: false,
      status: 'failed',
      text:
        `Commented on ${formatCount(result.results.length, 'task')}, but ` +
        `${formatCount(result.failures.length, 'task')} failed: ${titles}. ` +
        `${result.failures[0].error?.message ?? ''}`.trim(),
      error: result.failures[0].error?.message,
      result,
    };
  }

  return {
    ok: true,
    status: 'committed',
    text: `Commented on ${formatCount(result.results.length, 'task')}.`,
    result,
  };
}

async function executePropertyContactUpsert(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await upsertPropertyContact(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not save the property contact: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  // The no-op case needs the contact to lead the sentence — with the verb
  // first it reads as "Was already up to date "Joe's Plumbing"". The old
  // "Done - " prefix hid that; without it the two shapes have to differ.
  const noChange = result.mode === 'update' && result.changes?.length === 0;
  return {
    ok: true,
    status: 'committed',
    text: noChange
      ? `"${result.contact.name}" was already up to date.`
      : `${result.mode === 'create' ? 'Created' : 'Updated'} "${result.contact.name}".`,
    result,
  };
}

async function executePropertyContactDelete(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await deletePropertyContact(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not delete the property contact: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  return {
    ok: true,
    status: 'committed',
    text: `Deleted "${result.snapshot.name}".`,
    result,
  };
}

async function executeSlackFileAttachment(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as SlackFilePendingInput;
  const result = await commitSlackFileAttachment(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not attach the file: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }
  return {
    ok: true,
    status: 'committed',
    text: `${sentenceCase(result.plan.summary)}`,
    result,
  };
}


async function attachFiles(
  inboundFileIds: string[] | undefined,
  buildInput: (inboundFileId: string) => SlackFileAttachmentInput,
) {
  const ids = inboundFileIds ?? [];
  const results: Array<
    | { inbound_file_id: string; ok: true; row: unknown }
    | { inbound_file_id: string; ok: false; error: string }
  > = [];
  for (const inboundFileId of ids) {
    const result = await commitSlackFileAttachment(buildInput(inboundFileId));
    if (result.ok) {
      results.push({ inbound_file_id: inboundFileId, ok: true, row: result.row });
    } else {
      results.push({
        inbound_file_id: inboundFileId,
        ok: false,
        error: result.error.message,
      });
    }
  }
  return results;
}
