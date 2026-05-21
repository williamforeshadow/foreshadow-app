import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { isAgentCommand } from '@/src/lib/agentCommands';
import { getMyAssignmentsData } from '@/src/server/commands/myAssignments';
import { getDailyOutlookData } from '@/src/server/commands/dailyOutlook';
import {
  renderMyAssignmentsMarkdown,
  renderDailyOutlookMarkdown,
} from '@/src/server/commands/render';

// POST /api/agent/command
//
// Runs a deterministic in-app chat slash command (/myassignments,
// /dailyoutlook). No LLM — fixed query, fixed markdown output, instant.
// Mirrors the Slack slash-command handlers and shares their data layer
// (src/server/commands/*) so the two surfaces report identical data.
//
// Command output is intentionally NOT persisted to ai_chat_messages: it is a
// transient, deterministic view (like a Slack ephemeral), and persisting
// "/myassignments" as a conversation turn would pollute the agent's history.

export async function POST(req: NextRequest) {
  let command: string;
  let userId: string;
  try {
    const body = await req.json();
    command =
      typeof body?.command === 'string'
        ? body.command.trim().toLowerCase()
        : '';
    userId = body?.user_id;
    if (!isAgentCommand(command)) {
      return NextResponse.json(
        { error: `Unknown command: ${command || '(none)'}` },
        { status: 400 },
      );
    }
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid user_id' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow?.id) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 401 });
  }
  const displayName =
    (typeof userRow.name === 'string' && userRow.name.trim()) || 'there';

  let answer: string;
  if (command === '/myassignments') {
    answer = renderMyAssignmentsMarkdown(
      await getMyAssignmentsData(userId),
      displayName,
    );
  } else {
    answer = renderDailyOutlookMarkdown(
      await getDailyOutlookData(userId),
      displayName,
    );
  }

  return NextResponse.json({ answer });
}
