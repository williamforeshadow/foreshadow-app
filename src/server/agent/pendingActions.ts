import { getSupabaseServer } from '@/lib/supabaseServer';
import { taskUrl } from '@/src/lib/links';
import { createTask, type CreateTaskInput } from '@/src/server/tasks/createTask';
import { updateTask } from '@/src/server/tasks/updateTask';
import { deleteTask } from '@/src/server/tasks/deleteTask';
import { createTasksBatch } from '@/src/server/tasks/createTasksBatch';
import { updateTasksBatch } from '@/src/server/tasks/updateTasksBatch';
import { createBin } from '@/src/server/bins/createBin';
import { addComment } from '@/src/server/comments/addComment';
import { runSlackAutomationsForTaskAssignment } from '@/src/server/slackAutomations/run';
import {
  commitPropertyKnowledgeWrite,
  type PropertyKnowledgeWriteInput,
} from '@/src/server/properties/propertyKnowledgeWrite';
import { upsertPropertyNote } from '@/src/server/properties/upsertPropertyNote';
import { deletePropertyNote } from '@/src/server/properties/deletePropertyNote';
import { upsertPropertyContact } from '@/src/server/properties/upsertPropertyContact';
import { deletePropertyContact } from '@/src/server/properties/deletePropertyContact';
import {
  commitSlackFileAttachment,
  type SlackFileAttachmentInput,
} from '@/src/server/slack/attachInboundFile';

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
  | 'property_knowledge_write'
  | 'property_note_upsert'
  | 'property_note_delete'
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
  input: PropertyKnowledgeWriteInput;
  attachment_inbound_file_ids?: string[];
  attachment_caption?: string | null;
}

interface SlackFilePendingInput {
  input: SlackFileAttachmentInput;
}

interface GenericPendingInput {
  input: unknown;
}

export interface PendingActionRow {
  id: string;
  surface: 'slack';
  action_kind: PendingActionKind;
  status: 'pending' | 'processing' | 'committed' | 'cancelled' | 'failed' | 'expired';
  requester_app_user_id: string | null;
  slack_team_id: string | null;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  slack_message_ts: string | null;
  slack_user_id: string;
  canonical_input: unknown;
  preview: unknown;
  result: unknown;
  error_message: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

export interface CreatePendingActionArgs {
  kind: PendingActionKind;
  requesterAppUserId?: string | null;
  slack: SlackPendingActionContext;
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
      surface: 'slack',
      action_kind: args.kind,
      status: 'pending',
      requester_app_user_id: args.requesterAppUserId ?? null,
      slack_team_id: args.slack.teamId ?? null,
      slack_channel_id: args.slack.channelId,
      slack_thread_ts: args.slack.threadTs ?? null,
      slack_message_ts: args.slack.messageTs ?? null,
      slack_user_id: args.slack.userId,
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
  slackUserId: string;
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
  if (row.slack_user_id !== args.slackUserId) {
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
  slackUserId: string;
}): Promise<PendingExecutionResult> {
  const claimed = await claimPendingAction(args.actionId, args.slackUserId);
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
  slackUserId: string,
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
  if (row.slack_user_id !== slackUserId) {
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
  if (row.action_kind === 'property_note_upsert') {
    return executePropertyNoteUpsert(row);
  }
  if (row.action_kind === 'property_note_delete') {
    return executePropertyNoteDelete(row);
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

async function executeCreateTask(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as CreateTaskPendingInput;
  const result = await createTask(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not create the task: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  await runTaskAssignmentAutomationsForCreatedTask(row, result.task);

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
        ? `Done - created ${taskLink} and attached ${formatCount(attached, 'file')}.`
        : `Done - created ${taskLink}.`;

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
  const stored = row.canonical_input as GenericPendingInput;
  const result = await updateTask(stored.input);
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
        ? `Done - updated ${taskLink} (${formatCount(count, 'change')}).`
        : `Done - ${taskLink} was already up to date.`,
    result,
  };
}

async function executeDeleteTask(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await deleteTask(stored.input);
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
    text: `Done - deleted "${result.deleted.title}".`,
    result,
  };
}

async function executeCreateTasksBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await createTasksBatch(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not create the task batch: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  await Promise.all(
    result.result.tasks.map((task) =>
      runTaskAssignmentAutomationsForCreatedTask(row, task),
    ),
  );

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
        : `Done - created ${formatCount(created, 'task')}.${binText}`,
    error: result.result.failures[0]?.error.message,
    result,
  };
}

async function executeUpdateTasksBatch(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await updateTasksBatch(stored.input);
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
        : `Done - updated ${formatCount(updated, 'task')}.${skippedText}`,
    error: result.result.failures[0]?.error.message,
    result,
  };
}

async function executeCreateBin(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await createBin(stored.input);
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
    text: `Done - created sub-bin "${result.bin.name}".`,
    result,
  };
}

async function executeAddComment(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await addComment(stored.input);
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
    text: 'Done - added the comment.',
    result,
  };
}

async function executePropertyKnowledgeWrite(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as PropertyKnowledgePendingInput;
  const result = await commitPropertyKnowledgeWrite(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not update Property Knowledge: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const attachments = await attachPropertyKnowledgeFiles(stored, result.row);
  const attached = attachments.filter((a) => a.ok).length;
  const failed = attachments.filter((a) => !a.ok);
  const text =
    failed.length > 0
      ? `${result.plan.summary}, but ${formatCount(failed.length, 'attachment')} failed. ${failed[0].error}`
      : attached > 0
        ? `Done - ${result.plan.summary} and attached ${formatCount(attached, 'file')}.`
        : `Done - ${result.plan.summary}.`;

  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? 'committed' : 'failed',
    text,
    error: failed[0]?.error,
    result: { write: result, attachments },
  };
}

async function executePropertyNoteUpsert(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await upsertPropertyNote(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not save the property note: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const label = result.note.title?.trim() || `${result.note.scope} note`;
  const changeText =
    result.mode === 'update' && result.changes?.length === 0
      ? 'was already up to date'
      : result.mode === 'create'
        ? 'created'
        : 'updated';
  return {
    ok: true,
    status: 'committed',
    text: `Done - ${changeText} "${label}".`,
    result,
  };
}

async function executePropertyNoteDelete(
  row: PendingActionRow,
): Promise<PendingExecutionResult> {
  const stored = row.canonical_input as GenericPendingInput;
  const result = await deletePropertyNote(stored.input);
  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      text: `I could not delete the property note: ${result.error.message}`,
      error: result.error.message,
      result,
    };
  }

  const label = result.snapshot.title?.trim() || `${result.snapshot.scope} note`;
  return {
    ok: true,
    status: 'committed',
    text: `Done - deleted "${label}".`,
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

  const changeText =
    result.mode === 'update' && result.changes?.length === 0
      ? 'was already up to date'
      : result.mode === 'create'
        ? 'created'
        : 'updated';
  return {
    ok: true,
    status: 'committed',
    text: `Done - ${changeText} "${result.contact.name}".`,
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
    text: `Done - deleted "${result.snapshot.name}".`,
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
    text: `Done - ${result.plan.summary}`,
    result,
  };
}

async function runTaskAssignmentAutomationsForCreatedTask(
  row: PendingActionRow,
  task: { task_id: string; assigned_users: Array<{ user_id: string }> },
): Promise<void> {
  if (task.assigned_users.length === 0) return;

  try {
    await runSlackAutomationsForTaskAssignment({
      taskId: task.task_id,
      previousAssigneeIds: [],
      nextAssigneeIds: task.assigned_users.map((user) => user.user_id),
      actor: { user_id: row.requester_app_user_id },
    });
  } catch (err) {
    console.error('[agent pending actions] Slack assignment automation failed:', {
      taskId: task.task_id,
      err,
    });
  }
}

async function attachPropertyKnowledgeFiles(
  stored: PropertyKnowledgePendingInput,
  row: unknown,
) {
  const input = stored.input;
  const ids = stored.attachment_inbound_file_ids ?? [];
  if (ids.length === 0) return [];

  if (input.action !== 'upsert_card' && input.action !== 'upsert_room') {
    return ids.map((inboundFileId) => ({
      inbound_file_id: inboundFileId,
      ok: false as const,
      error: 'Attachments are only supported for room or card writes.',
    }));
  }

  const rowId =
    typeof row === 'object' && row !== null && 'id' in row
      ? String((row as { id?: unknown }).id ?? '')
      : '';
  const targetId =
    rowId ||
    (input.action === 'upsert_card' ? input.card_id : input.room_id) ||
    '';
  if (!targetId) {
    return ids.map((inboundFileId) => ({
      inbound_file_id: inboundFileId,
      ok: false as const,
      error: 'Could not determine the created Property Knowledge target id.',
    }));
  }

  return attachFiles(ids, (inboundFileId) =>
    input.action === 'upsert_card'
      ? {
          destination: 'property_card_photo',
          inbound_file_id: inboundFileId,
          property_id: input.property_id,
          card_id: targetId,
          caption: stored.attachment_caption ?? null,
        }
      : {
          destination: 'property_room_photo',
          inbound_file_id: inboundFileId,
          property_id: input.property_id,
          room_id: targetId,
          caption: stored.attachment_caption ?? null,
        },
  );
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
