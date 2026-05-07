import type { ToolCallTrace } from './runAgent';
import { WRITE_TOOL_NAMES } from './runAgent';

// Hallucination backstops.
//
// These run after the model produces text but before the user sees it. They
// are deliberately narrow: write claims require a successful write tool, and
// data-shaped answers require successful tool grounding unless the user asked
// a meta/capability question about what the agent can do.

const ACTION_CLAIM_RE =
  /\b(?:I(?:'ve|\s+have)?\s+(?:created|scheduled|assigned|updated|deleted|cancelled|completed|marked)|has\s+been\s+(?:created|scheduled|updated|deleted|cancelled|completed))\b/i;

export function maskHallucinatedWriteClaim(
  text: string,
  toolCalls: ToolCallTrace[],
): { text: string; replaced: boolean; original?: string } {
  if (!ACTION_CLAIM_RE.test(text)) {
    return { text, replaced: false };
  }

  const wroteSomething = toolCalls.some(
    (c) => WRITE_TOOL_NAMES.has(c.name) && c.output.ok === true,
  );
  if (wroteSomething) {
    return { text, replaced: false };
  }

  return {
    text: "I didn't complete that change because no write tool succeeded. Nothing was changed. Please try again with the change you want me to make.",
    replaced: true,
    original: text,
  };
}

const READ_TOOL_PREFIXES = ['find_', 'get_'];

function isReadTool(name: string): boolean {
  return READ_TOOL_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Capability/help questions are grounded in the tool catalog and system
 * prompt, not in live property/task rows. They should not be forced through
 * read tools unless the user asks for a specific record's data.
 */
export function isCapabilityOrHelpPrompt(prompt: string | undefined): boolean {
  if (!prompt) return false;
  const text = prompt.trim().toLowerCase();
  if (!text) return false;

  if (/\bwhat\s+can\s+you\s+do\b/.test(text)) return true;
  if (/\bwhat\s+are\s+you\s+able\s+to\s+do\b/.test(text)) return true;
  if (/\bwhich\s+(?:sections|things|records|files|data)\s+can\s+you\b/.test(text)) {
    return true;
  }
  if (/\bdo\s+you\s+have\s+(?:the\s+)?(?:capability|capabilities|ability|permission|permissions)\b/.test(text)) {
    return true;
  }
  if (/\bare\s+you\s+able\s+to\b/.test(text)) return true;

  // "Can you delete property information?" is usually a capability check,
  // while "can you delete the Turf Patio card" may be an actual request.
  // The write backstop still protects fabricated success claims either way.
  if (/^can\s+you\b/.test(text) && /[?]$/.test(text)) {
    const genericOpsTarget =
      /\b(?:property\s+(?:profile|profiles|information|knowledge)|profiles?|tasks?|attachments?|documents?|photos?|videos?|files?|notes?|vendors?|contacts?|access|connectivity|interior|exterior|activity)\b/.test(text);
    const concreteRecordCue =
      /\b(?:\d{3,}|#\d+|called|named|titled|for\s+\d|at\s+\d)\b/.test(text);
    return genericOpsTarget && !concreteRecordCue;
  }

  return false;
}

function looksLikeDataAnswer(text: string): boolean {
  const numbered = (text.match(/^\s*\d+\.\s\S/gm) ?? []).length;
  if (numbered >= 3) return true;

  const bullets = (text.match(/^\s*[-*]\s\S/gm) ?? []).length;
  if (bullets >= 3) return true;

  const headers = (text.match(/^\s*#{2,3}\s\S/gm) ?? []).length;
  if (headers >= 2) return true;

  const labels = (text.match(/\*\*[^*\n]+\*\*\s*:/g) ?? []).length;
  if (labels >= 3) return true;

  return false;
}

export function maskHallucinatedReadClaim(
  text: string,
  toolCalls: ToolCallTrace[],
  prompt?: string,
): { text: string; replaced: boolean; original?: string } {
  if (!looksLikeDataAnswer(text)) {
    return { text, replaced: false };
  }
  if (isCapabilityOrHelpPrompt(prompt)) {
    return { text, replaced: false };
  }

  const anyToolSucceeded = toolCalls.some(
    (c) =>
      c.output.ok === true && (isReadTool(c.name) || WRITE_TOOL_NAMES.has(c.name)),
  );
  if (anyToolSucceeded) {
    return { text, replaced: false };
  }

  return {
    text: "I need to look that up live, but I couldn't identify the right record or tool. Tell me the property, task, or section you mean.",
    replaced: true,
    original: text,
  };
}

export function applyBackstops(
  text: string,
  toolCalls: ToolCallTrace[],
  options: { prompt?: string } = {},
): {
  text: string;
  writeMasked: boolean;
  readMasked: boolean;
  originalIfMasked?: string;
} {
  const w = maskHallucinatedWriteClaim(text, toolCalls);
  const r = maskHallucinatedReadClaim(w.text, toolCalls, options.prompt);
  return {
    text: r.text,
    writeMasked: w.replaced,
    readMasked: r.replaced,
    originalIfMasked: w.replaced || r.replaced ? text : undefined,
  };
}
