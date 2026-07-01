import type { MessageParam, TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { getConversationContext } from './conversationContext';
import type { TrainingTier, TrainingCategory } from './conciergeTraining';

// AI-assisted authoring for concierge training blocks. Turns loose operator
// input into a clean, structured block the operator then reviews before saving:
//   - structureTrainingFromNote: a sloppy plain-language note → structured block.
//   - structureTrainingFromConversation: selected messages from a real guest
//     conversation → structured block + a faithful worked example.
//
// This module ONLY suggests. It never writes to the database — the existing
// /api/concierge-training routes remain the single write path, fed by the
// reviewed-and-edited dialog. The example transcript is rendered deterministically
// from the selected messages here; the model writes the title/instructions/label
// but never the transcript, so an example can never misquote what a guest said.

const STRUCTURE_MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You convert an operator's guidance into a clean, reusable "training block" for an AI assistant that drafts guest messages (and triages operational tasks) for a property / hospitality operations team.

A training block is a durable rule the AI follows on future conversations — not a one-off answer. Write it so it generalizes to similar future situations, grounded ONLY in what the operator gave you. Never invent policies, names, numbers, or specifics they did not provide.

Produce these fields:
- title: a short, specific name for the topic or procedure (e.g. "Early check-in requests", "Lockbox code policy"). A few words, no trailing punctuation.
- instructions: the rule itself, as concise directive guidance the AI should follow. Generalize from the operator's input; do NOT restate any example transcript verbatim. Plain text, a few sentences or short bullet lines.
- tier: "always" if this is a universal guardrail, voice, or safety/policy rule that should apply to EVERY guest message; "situational" if it is a topic-specific playbook only relevant when the guest's message is about that topic. Prefer "situational" for specific procedures; reserve "always" for truly universal rules.
- category: "reply" if it guides how to respond to guests; "task" if it guides when to create operational work/tasks. Default to "reply".
- label: a short phrase describing what the worked example demonstrates (only meaningful when an example transcript is provided; otherwise return an empty string).

Output: respond with ONLY a single JSON object, no prose, no code fences. Shape:
{"title": string, "instructions": string, "tier": "always"|"situational", "category": "reply"|"task", "label": string}`;

export interface StructuredTrainingBlock {
  title: string;
  instructions: string;
  tier: TrainingTier;
  category: TrainingCategory;
  /** Faithful render of the selected messages; null for note-based authoring. */
  example: { label: string; transcript: string } | null;
}

export type StructureTrainingResult =
  | { ok: true; data: StructuredTrainingBlock }
  | { ok: false; error: { code: 'invalid_input' | 'not_found' | 'model_error'; message: string } };

/** Parse the single JSON object the model returns, tolerating code fences. */
function parseStructuredJson(raw: string): {
  title: string;
  instructions: string;
  tier: TrainingTier;
  category: TrainingCategory;
  label: string;
} | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return null; // a block with no title is unusable
  const instructions = typeof o.instructions === 'string' ? o.instructions.trim() : '';
  const tier: TrainingTier = o.tier === 'always' ? 'always' : 'situational';
  const category: TrainingCategory = o.category === 'task' ? 'task' : 'reply';
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  return { title, instructions, tier, category, label };
}

/** One deterministic structuring pass over a user message. */
async function runStructuring(userContent: string): Promise<
  | { title: string; instructions: string; tier: TrainingTier; category: TrainingCategory; label: string }
  | null
> {
  const client = getAnthropic();
  const messages: MessageParam[] = [{ role: 'user', content: userContent }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: STRUCTURE_MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages,
  });
  const raw = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return parseStructuredJson(raw);
}

/** Render selected messages faithfully, in the same Host/Guest form drafts use. */
function renderTranscript(
  messages: Array<{ direction: string; body: string | null }>,
): string {
  return messages
    .map(
      (m) =>
        `${m.direction === 'outbound' ? 'Host' : 'Guest'}: ${(m.body ?? '').trim() || '(no text)'}`,
    )
    .join('\n');
}

/**
 * Structure a plain-language operator note into a training block. No example.
 */
export async function structureTrainingFromNote(
  note: string,
): Promise<StructureTrainingResult> {
  const trimmed = note.trim();
  if (!trimmed) {
    return { ok: false, error: { code: 'invalid_input', message: 'A note is required.' } };
  }
  try {
    const userContent = [
      "Here is the operator's note. Structure it into a training block:",
      '',
      trimmed,
    ].join('\n');
    const parsed = await runStructuring(userContent);
    if (!parsed) {
      return { ok: false, error: { code: 'model_error', message: 'Could not structure the note.' } };
    }
    return {
      ok: true,
      data: {
        title: parsed.title,
        instructions: parsed.instructions,
        tier: parsed.tier,
        category: parsed.category,
        example: null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Structuring failed.';
    return { ok: false, error: { code: 'model_error', message } };
  }
}

/**
 * Structure a training block from selected messages in a real conversation. The
 * faithful transcript becomes the worked example; the model infers the general
 * rule it demonstrates.
 */
export async function structureTrainingFromConversation(args: {
  conversationId: string;
  messageIds: string[];
}): Promise<StructureTrainingResult> {
  const { conversationId, messageIds } = args;
  if (!conversationId || messageIds.length === 0) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'A conversation and at least one message are required.' },
    };
  }

  let ctx;
  try {
    ctx = await getConversationContext(conversationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load conversation.';
    return { ok: false, error: { code: 'model_error', message } };
  }
  if (!ctx) {
    return { ok: false, error: { code: 'not_found', message: 'Conversation not found.' } };
  }

  // Keep only the selected messages, preserving the thread's chronological order.
  const idSet = new Set(messageIds);
  const selected = ctx.messages.filter((m) => idSet.has(m.id));
  if (selected.length === 0) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'None of the selected messages were found in this conversation.' },
    };
  }

  const transcript = renderTranscript(selected);

  try {
    const userContent = [
      'Below is a transcript excerpt the operator selected as a worked example of how a situation should be handled.',
      'Infer the general rule it demonstrates and structure a training block the AI could apply to similar future conversations.',
      'Do not restate the transcript in the instructions — keep the instructions general. Set "label" to a short description of what the example shows.',
      '',
      'Selected transcript:',
      transcript,
    ].join('\n');
    const parsed = await runStructuring(userContent);
    if (!parsed) {
      return {
        ok: false,
        error: { code: 'model_error', message: 'Could not structure the conversation.' },
      };
    }
    return {
      ok: true,
      data: {
        title: parsed.title,
        instructions: parsed.instructions,
        tier: parsed.tier,
        category: parsed.category,
        example: { label: parsed.label, transcript },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Structuring failed.';
    return { ok: false, error: { code: 'model_error', message } };
  }
}
