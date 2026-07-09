import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { isAgentCommand } from '@/src/lib/agentCommands';
import {
  getMyAssignmentsData,
  type AssignmentTask,
} from '@/src/server/commands/myAssignments';
import { getDailyOutlookData } from '@/src/server/commands/dailyOutlook';
import {
  renderMyAssignmentsMarkdown,
  renderDailyOutlookMarkdown,
  TOMORROW_OUTLOOK_COPY,
} from '@/src/server/commands/render';
import type { TaskRow } from '@/src/agent/tools/findTasks';

// POST /api/agent/command
//
// Runs a deterministic in-app chat slash command (/myassignments,
// /dailyoutlook). No LLM — fixed query, fixed markdown output, instant.
// Mirrors the Slack slash-command handlers and shares their data layer
// (src/server/commands/*) so the two surfaces report identical data.
//
// Returns `tasks` (the same TaskRow card shape the agent's find_tasks tool
// emits) alongside the markdown so the in-app chat renders the visual task
// cards under a command reply, exactly as it does for an agent turn. The
// frontend keys the cards off the `/tasks/<id>` links the markdown already
// carries (see referencedTasks in AiChatPanel), so command and agent replies
// stay visually identical. This is web-only — Slack renders its own Block Kit.
//
// Command output is intentionally NOT persisted to ai_chat_messages: it is a
// transient, deterministic view (like a Slack ephemeral), and persisting
// "/myassignments" as a conversation turn would pollute the agent's history.

// Adapt a command AssignmentTask (TaskByIdRow + deep link) into the TaskRow
// shape the chat card components consume. The two row types overlap almost
// entirely; we derive has_template, carry the precomputed url as task_url,
// and drop the avatar from assigned users (the card doesn't use it).
function assignmentTaskToCardRow(at: AssignmentTask): TaskRow {
  const t = at.task;
  return {
    task_id: t.task_id,
    reservation_id: t.reservation_id,
    property_id: t.property_id,
    property_name: t.property_name,
    template_id: t.template_id,
    template_name: t.template_name,
    title: t.title,
    priority: t.priority,
    department_id: t.department_id,
    department_name: t.department_name,
    status: t.status,
    scheduled_date: t.scheduled_date,
    scheduled_time: t.scheduled_time,
    bin_id: t.bin_id,
    bin_name: t.bin_name,
    bin_is_system: t.bin_is_system,
    is_binned: t.is_binned,
    has_template: t.template_id != null,
    guest_name: t.guest_name,
    check_in: t.check_in,
    check_out: t.check_out,
    assigned_users: t.assigned_users.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      role: u.role,
    })),
    comment_count: t.comment_count,
    attachment_count: t.attachment_count,
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at,
    task_url: at.url,
  };
}

export async function POST(req: NextRequest) {
  let command: string;
  try {
    const body = await req.json();
    command =
      typeof body?.command === 'string'
        ? body.command.trim().toLowerCase()
        : '';
    // NOTE: body.user_id is intentionally IGNORED — the acting user comes from
    // the verified session (a client-supplied id allowed impersonating any
    // user, and thereby reading any org's outlook).
    if (!isAgentCommand(command)) {
      return NextResponse.json(
        { error: `Unknown command: ${command || '(none)'}` },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { appUser } = authCtx;
  const userId = appUser.id;
  const displayName = (appUser.name && appUser.name.trim()) || 'there';

  let answer: string;
  let tasks: TaskRow[];
  if (command === '/myassignments') {
    const data = await getMyAssignmentsData(userId);
    answer = renderMyAssignmentsMarkdown(data, displayName);
    tasks = data.tasks.map(assignmentTaskToCardRow);
  } else if (command === '/tomorrow') {
    const data = await getDailyOutlookData(userId, 1);
    answer = renderDailyOutlookMarkdown(data, displayName, TOMORROW_OUTLOOK_COPY);
    tasks = data.tasks.map(assignmentTaskToCardRow);
  } else {
    const data = await getDailyOutlookData(userId);
    answer = renderDailyOutlookMarkdown(data, displayName);
    tasks = data.tasks.map(assignmentTaskToCardRow);
  }

  return NextResponse.json({ answer, tasks });
}
