import { NextRequest, NextResponse } from 'next/server';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runAgent } from '@/src/agent/runAgent';

// POST /api/agent
//
// Tool-calling chat agent. The model never writes SQL — it answers data
// questions by invoking tools registered in src/agent/tools. This route is a
// thin shell that handles HTTP, conversation memory, and persistence; all
// LLM + tool dispatch lives in src/agent/runAgent.

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
  let userId: string | undefined;
  try {
    const body = await req.json();
    prompt = body?.prompt;
    userId = body?.user_id;
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid prompt' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Pull recent conversation history. We persist only final assistant text
  // (no tool_use / tool_result blocks) so the history we replay is plain
  // text on both sides — the agent will re-invoke tools as needed.
  let history: MessageParam[] = [];
  if (userId) {
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

    await supabase.from('ai_chat_messages').insert({
      user_id: userId,
      role: 'user',
      content: prompt,
    });
  }

  try {
    const result = await runAgent({ history, prompt });

    if (userId) {
      await supabase.from('ai_chat_messages').insert({
        user_id: userId,
        role: 'assistant',
        content: result.text,
        // Store a lightweight trace of which tools fired and what input the
        // model passed. Useful for debugging without bloating the row.
        metadata: {
          tool_calls: result.toolCalls.map((c) => ({
            name: c.name,
            input: c.input,
            ok: c.output.ok,
          })),
        },
      });
    }

    return NextResponse.json({
      answer: result.text,
      tool_calls: result.toolCalls,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Agent error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
