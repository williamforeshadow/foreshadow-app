import type {
  BetaMessage,
  BetaMessageParam,
  BetaContentBlock,
  BetaContentBlockParam,
  BetaTool,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages';
import OpenAI from 'openai';
import type {
  Response as OpenAIResponse,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseInputContent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses';
import { getAnthropic, MODEL, FILES_BETA } from './anthropic';

// Provider switch for the two agent loops (runAgent + the concierge draft
// generator). Both loops speak Anthropic's message shapes internally; this
// module either passes the request straight through to Anthropic or translates
// it to the OpenAI RESPONSES API and translates the response back. The loops
// themselves never branch on provider.
//
// Toggle: AGENT_MODEL_PROVIDER=openai (default: anthropic). Model on the
// OpenAI path: OPENAI_AGENT_MODEL (default gpt-5.6-terra).
//
// Why Responses and not Chat Completions: gpt-5.6-terra rejects function
// tools combined with reasoning_effort on /v1/chat/completions (400: "use
// /v1/responses or set reasoning_effort to 'none'"). Reasoning + tools —
// the whole point of this agent — is only available on /v1/responses.
//
// OpenAI-path notes:
//  - Reasoning models require the reasoning item that preceded a function
//    call to be REPLAYED with it on the next request. Our loops keep
//    conversation state in Anthropic block shapes, which have nowhere to put
//    OpenAI reasoning items — so each response's raw output items are cached
//    in-process keyed by tool-call id (see outputReplayCache) and re-injected
//    verbatim when the conversation is translated back. The cache always hits
//    within a single runAgent loop (same process, seconds apart). If an old
//    assistant tool exchange ever arrives without a cache entry, it degrades
//    to a plain-text rendition of the calls and results instead of erroring.
//  - Anthropic Files API references (the ops agent's photo/PDF attachments)
//    are resolved back to the stored originals and inlined as data: URLs —
//    same normalisation as the Anthropic upload path, cached per process (see
//    loadRenderableByAnthropicFileId). A file that can't be resolved degrades
//    to a visible "[attachment not available to this model]" placeholder.
//  - cache_control markers are dropped (OpenAI caches prefixes automatically).
//  - Requests use store:false + include reasoning.encrypted_content so the
//    replayed reasoning items are self-contained (nothing server-side to
//    reference) and no conversation state accumulates on OpenAI's side.

export type ModelProvider = 'anthropic' | 'openai';

export function getModelProvider(): ModelProvider {
  return process.env.AGENT_MODEL_PROVIDER === 'openai' ? 'openai' : 'anthropic';
}

const OPENAI_AGENT_MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.6-terra';

// 'medium' matches the Anthropic path's adaptive-thinking-at-medium-effort
// setting so provider A/Bs compare like with like. Reasoning tokens share
// max_output_tokens with the reply; MAX_TOKENS in runAgent.ts carries the
// headroom. (gpt-5.6-terra's ladder is none/low/medium/high/xhigh.)
const OPENAI_REASONING_EFFORT =
  process.env.OPENAI_AGENT_REASONING_EFFORT || 'medium';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey.trim()) {
      throw new Error(
        'AGENT_MODEL_PROVIDER=openai but OPENAI_API_KEY is empty or unset in this process.',
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export interface ModelMessageRequest {
  max_tokens: number;
  system: BetaTextBlockParam[];
  tools: BetaTool[];
  messages: BetaMessageParam[];
  /** Arm the Files API beta (Anthropic path only; ignored on OpenAI). */
  files?: boolean;
}

export async function createModelMessage(
  req: ModelMessageRequest,
): Promise<BetaMessage> {
  if (getModelProvider() === 'openai') {
    return createViaOpenAI(req);
  }
  return getAnthropic().beta.messages.create({
    model: MODEL,
    max_tokens: req.max_tokens,
    // Adaptive thinking at medium effort: with 45 tools and a rule-dense
    // protocol, tool selection is exactly the workload thinking exists for.
    // Thinking tokens share max_tokens with the visible reply — the loop's
    // MAX_TOKENS is sized with that headroom (see runAgent.ts).
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: req.system,
    tools: req.tools,
    messages: req.messages,
    ...(req.files ? { betas: [FILES_BETA] } : {}),
  });
}

// ---------------------------------------------------------------------------
// Anthropic → OpenAI Responses translation

const UNAVAILABLE_ATTACHMENT = '[attachment not available to this model]';

/**
 * Raw Responses output items keyed by the call_id of every function_call they
 * contain. Reasoning models require the reasoning item that preceded a
 * function call to be sent back with it; the Anthropic-shaped conversation the
 * loops maintain can't carry those items, so we stash the verbatim output here
 * and re-inject it at translation time. Bounded FIFO — entries are only needed
 * for the seconds a runAgent loop is in flight.
 */
const REPLAY_CACHE_MAX = 256;
const outputReplayCache = new Map<string, ResponseOutputItem[]>();

function cacheOutputForReplay(output: ResponseOutputItem[]): void {
  const callIds = output
    .filter((i): i is Extract<ResponseOutputItem, { type: 'function_call' }> => i.type === 'function_call')
    .map((i) => i.call_id);
  for (const id of callIds) {
    outputReplayCache.delete(id);
    outputReplayCache.set(id, output);
  }
  while (outputReplayCache.size > REPLAY_CACHE_MAX) {
    const oldest = outputReplayCache.keys().next().value;
    if (oldest === undefined) break;
    outputReplayCache.delete(oldest);
  }
}

/**
 * Resolve an Anthropic file_id to an inline data: URL (image or PDF).
 *
 * Lazily imported so the prep module's sharp/heic-convert/document parsers
 * stay out of the graph on the Anthropic path and for OpenAI turns with no
 * attachments. Never throws — null means "show the placeholder".
 */
async function resolveInlineFile(
  fileId: string,
): Promise<{ kind: 'image' | 'pdf'; dataUrl: string; filename: string } | null> {
  try {
    const { loadRenderableByAnthropicFileId } = await import(
      '@/src/server/agent/inboundFileVisionPrep'
    );
    return await loadRenderableByAnthropicFileId(fileId);
  } catch (err) {
    console.warn('[modelProvider] inline file resolve failed', err);
    return null;
  }
}

function toResponsesTools(tools: BetaTool[]): ResponsesTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description ?? null,
    parameters: t.input_schema as unknown as Record<string, unknown>,
    strict: false,
  }));
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && (b as { type?: string }).type === 'text'
          ? (b as { text: string }).text
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

interface AnthropicToolUseLike {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Translate the Anthropic-shaped conversation into Responses input items.
 *
 * Assistant turns whose tool calls are still in the replay cache are emitted
 * as the verbatim output items OpenAI produced (reasoning item included);
 * their tool_result blocks then pair up as function_call_output items. A
 * cache miss degrades that exchange to plain text on both sides — lossy but
 * valid, and it can only happen for exchanges from a different process.
 */
async function toResponsesInput(
  messages: BetaMessageParam[],
): Promise<ResponseInputItem[]> {
  const out: ResponseInputItem[] = [];
  // call_ids emitted as real function_call items; results pair with these.
  const emittedCallIds = new Set<string>();

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      const toolUses = msg.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => b as unknown as AnthropicToolUseLike);

      if (toolUses.length === 0) {
        if (text) out.push({ role: 'assistant', content: text });
        continue;
      }

      const replay = outputReplayCache.get(toolUses[0].id);
      const replayCovers =
        replay &&
        toolUses.every((u) =>
          replay.some((i) => i.type === 'function_call' && i.call_id === u.id),
        );

      if (replay && replayCovers) {
        out.push(...(replay as unknown as ResponseInputItem[]));
        for (const u of toolUses) emittedCallIds.add(u.id);
      } else {
        // Fallback: render the exchange as text. The matching tool_result
        // blocks (below) render as text too, so nothing dangles.
        const lines = [
          ...(text ? [text] : []),
          ...toolUses.map(
            (u) => `[Called tool ${u.name} with input ${JSON.stringify(u.input ?? {})}]`,
          ),
        ];
        out.push({ role: 'assistant', content: lines.join('\n') });
      }
      continue;
    }

    // User message: tool_result blocks become function_call_output items when
    // their call was emitted for real; everything else becomes one user
    // message of content parts.
    const parts: ResponseInputContent[] = [];
    for (const block of msg.content as BetaContentBlockParam[]) {
      switch (block.type) {
        case 'tool_result': {
          const output = toolResultText(block.content) || '(empty result)';
          if (emittedCallIds.has(block.tool_use_id)) {
            out.push({
              type: 'function_call_output',
              call_id: block.tool_use_id,
              output,
            });
          } else {
            parts.push({ type: 'input_text', text: `[Tool result]\n${output}` });
          }
          break;
        }
        case 'text':
          parts.push({ type: 'input_text', text: block.text });
          break;
        case 'image': {
          const source = block.source as
            | { type: 'base64'; media_type: string; data: string }
            | { type: 'file'; file_id: string }
            | { type: 'url'; url: string };
          if (source.type === 'base64') {
            parts.push({
              type: 'input_image',
              image_url: `data:${source.media_type};base64,${source.data}`,
              detail: 'auto',
            });
          } else if (source.type === 'url') {
            parts.push({ type: 'input_image', image_url: source.url, detail: 'auto' });
          } else {
            const inline = await resolveInlineFile(source.file_id);
            if (inline) {
              parts.push({ type: 'input_image', image_url: inline.dataUrl, detail: 'auto' });
            } else {
              parts.push({ type: 'input_text', text: UNAVAILABLE_ATTACHMENT });
            }
          }
          break;
        }
        case 'document': {
          const source = block.source as
            | { type: 'text'; media_type: string; data: string }
            | { type: 'base64'; media_type: string; data: string }
            | { type: 'file'; file_id: string };
          const title = (block as { title?: string | null }).title ?? null;
          if (source.type === 'text') {
            // Extracted text documents (CSV, docx, xlsx…) — inline them under
            // their title, exactly the content the Anthropic path would see.
            parts.push({
              type: 'input_text',
              text: `${title ? `Document "${title}":\n` : ''}${source.data}`,
            });
          } else if (source.type === 'base64' && source.media_type === 'application/pdf') {
            parts.push({
              type: 'input_file',
              filename: title || 'document.pdf',
              file_data: `data:application/pdf;base64,${source.data}`,
            });
          } else if (source.type === 'file') {
            const inline = await resolveInlineFile(source.file_id);
            if (inline?.kind === 'pdf') {
              parts.push({
                type: 'input_file',
                filename: inline.filename || title || 'document.pdf',
                file_data: inline.dataUrl,
              });
            } else if (inline?.kind === 'image') {
              parts.push({ type: 'input_image', image_url: inline.dataUrl, detail: 'auto' });
            } else {
              parts.push({ type: 'input_text', text: UNAVAILABLE_ATTACHMENT });
            }
          } else {
            parts.push({ type: 'input_text', text: UNAVAILABLE_ATTACHMENT });
          }
          break;
        }
        default:
          break;
      }
    }
    if (parts.length > 0) {
      out.push({ role: 'user', content: parts });
    }
  }

  return out;
}

function fromResponses(response: OpenAIResponse): BetaMessage {
  const content: BetaContentBlock[] = [];
  for (const item of response.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) {
          content.push({
            type: 'text',
            text: part.text,
            citations: null,
          } as BetaContentBlock);
        }
      }
    } else if (item.type === 'function_call') {
      let input: unknown = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        // Leave {} — the tool's schema validation will surface a real error
        // the model can react to on the next turn.
      }
      content.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input,
      } as BetaContentBlock);
    }
    // reasoning items are not translated — they ride back via the replay cache.
  }

  cacheOutputForReplay(response.output ?? []);

  const hasToolUse = content.some((b) => b.type === 'tool_use');
  const stop_reason = hasToolUse
    ? 'tool_use'
    : response.status === 'incomplete' &&
        response.incomplete_details?.reason === 'max_output_tokens'
      ? 'max_tokens'
      : 'end_turn';

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens:
        response.usage?.input_tokens_details?.cached_tokens ?? 0,
    },
  } as BetaMessage;
}

async function createViaOpenAI(req: ModelMessageRequest): Promise<BetaMessage> {
  const client = getOpenAI();
  const response = await client.responses.create({
    model: OPENAI_AGENT_MODEL,
    max_output_tokens: req.max_tokens,
    reasoning: {
      effort: OPENAI_REASONING_EFFORT as OpenAI.ReasoningEffort,
    },
    // Stateless: nothing persists server-side, and encrypted reasoning
    // content makes the replayed items self-contained.
    store: false,
    include: ['reasoning.encrypted_content'],
    instructions: req.system.map((b) => b.text).join('\n\n'),
    input: await toResponsesInput(req.messages),
    ...(req.tools.length > 0 ? { tools: toResponsesTools(req.tools) } : {}),
  });
  return fromResponses(response);
}
