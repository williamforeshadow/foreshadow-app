import { NextRequest, NextResponse } from 'next/server';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runAgent } from '@/src/agent/runAgent';
import { applyBackstops } from '@/src/agent/backstops';

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
  let userId: string | undefined;
  let clientTz: string | undefined;
  try {
    const body = await req.json();
    prompt = body?.prompt;
    userId = body?.user_id;
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
    const result = await runAgent({ history, prompt, clientTz });

    // Backstops: if the model claimed a side-effect happened but no write
    // tool succeeded, OR it produced a structured data answer with no read
    // tool succeeded, swap in a safe message before the user ever sees it.
    // Both flags are persisted in metadata so reviewers can spot masked
    // rows quickly.
    const masked = applyBackstops(result.text, result.toolCalls);
    if (masked.writeMasked) {
      console.warn('[agent] masked hallucinated write claim', {
        user_id: userId,
        prompt,
        original: masked.originalIfMasked,
      });
    }
    if (masked.readMasked) {
      console.warn('[agent] masked hallucinated read claim', {
        user_id: userId,
        prompt,
        original: masked.originalIfMasked,
      });
    }
    const finalText = masked.text;

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
          ...(masked.readMasked ? { masked_read_claim: true } : {}),
        },
      });
    }

    return NextResponse.json({
      answer: finalText,
      tool_calls: result.toolCalls,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Agent error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
