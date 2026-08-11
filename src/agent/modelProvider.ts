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
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions';
import { getAnthropic, MODEL, FILES_BETA } from './anthropic';

// Provider switch for the two agent loops (runAgent + the concierge draft
// generator). Both loops speak Anthropic's message shapes internally; this
// module either passes the request straight through to Anthropic or translates
// it to OpenAI Chat Completions and translates the response back. The loops
// themselves never branch on provider.
//
// Toggle: AGENT_MODEL_PROVIDER=openai (default: anthropic). Model on the
// OpenAI path: OPENAI_AGENT_MODEL (default gpt-5.6-terra).
//
// OpenAI-path notes:
//  - Anthropic Files API references (the ops agent's photo/PDF attachments)
//    are resolved back to the stored originals and inlined as data: URLs —
//    same normalisation as the Anthropic upload path, cached per process (see
//    loadRenderableByAnthropicFileId). A file that can't be resolved degrades
//    to a visible "[attachment not available to this model]" placeholder.
//  - cache_control markers are dropped (OpenAI caches prefixes automatically).

export type ModelProvider = 'anthropic' | 'openai';

export function getModelProvider(): ModelProvider {
  return process.env.AGENT_MODEL_PROVIDER === 'openai' ? 'openai' : 'anthropic';
}

const OPENAI_AGENT_MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.6-terra';

// 'none' matches the Anthropic loops' pinned-off thinking: reasoning tokens
// share max_completion_tokens with the reply, and both loops budget max_tokens
// for the visible output alone. Raise via env if tool selection needs the help.
// (gpt-5.6-terra's ladder is none/low/medium/high/xhigh — no 'minimal'.)
const OPENAI_REASONING_EFFORT =
  process.env.OPENAI_AGENT_REASONING_EFFORT || 'none';

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
    thinking: { type: 'disabled' },
    system: req.system,
    tools: req.tools,
    messages: req.messages,
    ...(req.files ? { betas: [FILES_BETA] } : {}),
  });
}

// ---------------------------------------------------------------------------
// Anthropic → OpenAI translation

const UNAVAILABLE_ATTACHMENT = '[attachment not available to this model]';

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

function toOpenAITools(tools: BetaTool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
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

async function toOpenAIMessages(
  system: BetaTextBlockParam[],
  messages: BetaMessageParam[],
): Promise<ChatCompletionMessageParam[]> {
  const out: ChatCompletionMessageParam[] = [
    { role: 'system', content: system.map((b) => b.text).join('\n\n') },
  ];

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
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = msg.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          const use = b as { id: string; name: string; input: unknown };
          return {
            id: use.id,
            type: 'function' as const,
            function: {
              name: use.name,
              arguments: JSON.stringify(use.input ?? {}),
            },
          };
        });
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // User message: tool_result blocks become `tool` role messages (they must
    // directly follow the assistant turn that issued the calls); everything
    // else becomes one user message of content parts.
    const parts: ChatCompletionContentPart[] = [];
    for (const block of msg.content as BetaContentBlockParam[]) {
      switch (block.type) {
        case 'tool_result':
          out.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: toolResultText(block.content) || '(empty result)',
          });
          break;
        case 'text':
          parts.push({ type: 'text', text: block.text });
          break;
        case 'image': {
          const source = block.source as
            | { type: 'base64'; media_type: string; data: string }
            | { type: 'file'; file_id: string }
            | { type: 'url'; url: string };
          if (source.type === 'base64') {
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${source.media_type};base64,${source.data}`,
              },
            });
          } else if (source.type === 'url') {
            parts.push({ type: 'image_url', image_url: { url: source.url } });
          } else {
            const inline = await resolveInlineFile(source.file_id);
            if (inline) {
              parts.push({
                type: 'image_url',
                image_url: { url: inline.dataUrl },
              });
            } else {
              parts.push({ type: 'text', text: UNAVAILABLE_ATTACHMENT });
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
              type: 'text',
              text: `${title ? `Document "${title}":\n` : ''}${source.data}`,
            });
          } else if (source.type === 'base64' && source.media_type === 'application/pdf') {
            parts.push({
              type: 'file',
              file: {
                filename: title || 'document.pdf',
                file_data: `data:application/pdf;base64,${source.data}`,
              },
            });
          } else if (source.type === 'file') {
            const inline = await resolveInlineFile(source.file_id);
            if (inline?.kind === 'pdf') {
              parts.push({
                type: 'file',
                file: {
                  filename: inline.filename || title || 'document.pdf',
                  file_data: inline.dataUrl,
                },
              });
            } else if (inline?.kind === 'image') {
              parts.push({
                type: 'image_url',
                image_url: { url: inline.dataUrl },
              });
            } else {
              parts.push({ type: 'text', text: UNAVAILABLE_ATTACHMENT });
            }
          } else {
            parts.push({ type: 'text', text: UNAVAILABLE_ATTACHMENT });
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

async function createViaOpenAI(req: ModelMessageRequest): Promise<BetaMessage> {
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: OPENAI_AGENT_MODEL,
    max_completion_tokens: req.max_tokens,
    reasoning_effort:
      OPENAI_REASONING_EFFORT as OpenAI.ReasoningEffort,
    messages: await toOpenAIMessages(req.system, req.messages),
    ...(req.tools.length > 0 ? { tools: toOpenAITools(req.tools) } : {}),
  });

  const choice = completion.choices[0];
  if (!choice) {
    throw new Error('OpenAI returned no choices.');
  }
  const msg = choice.message;

  const content: BetaContentBlock[] = [];
  if (msg.content) {
    content.push({
      type: 'text',
      text: msg.content,
      citations: null,
    } as BetaContentBlock);
  }
  for (const tc of msg.tool_calls ?? []) {
    if (tc.type !== 'function') continue;
    let input: unknown = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      // Leave {} — the tool's schema validation will surface a real error the
      // model can react to on the next turn.
    }
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input,
    } as BetaContentBlock);
  }

  const stop_reason =
    choice.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice.finish_reason === 'length'
        ? 'max_tokens'
        : 'end_turn';

  return {
    id: completion.id,
    type: 'message',
    role: 'assistant',
    model: completion.model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens:
        completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  } as BetaMessage;
}
