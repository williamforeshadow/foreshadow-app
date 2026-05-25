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
 * Returns true when the user's message is not a request for live record
 * data: a capability/help question ("what can you do?", "can you make a
 * task"), a greeting, or smalltalk. The model answers these from the system
 * prompt and tool catalog without calling a read tool, so the read backstop
 * must not mask them — only genuine data lookups are held to the
 * tool-grounding contract.
 */
export function isNonDataLookupPrompt(prompt: string | undefined): boolean {
  if (!prompt) return false;
  const text = prompt.trim().toLowerCase();
  if (!text) return false;

  // Greeting / thanks / short acknowledgement with no data ask — the whole
  // message is just that, so there is nothing for a tool to look up.
  if (
    /^(?:hi+|hey+|hello+|yo|sup|howdy|hiya|greetings|good\s+(?:morning|afternoon|evening|day))(?:\s+(?:there|foreshadow|bot|claude))?[\s!.,'-]*$/.test(
      text,
    )
  ) {
    return true;
  }
  if (/^(?:thank(?:s|\s+you)?|ty|cheers|nice|cool|great|ok(?:ay)?|got\s+it)\b[\s!.,'-]*$/.test(text)) {
    return true;
  }
  if (/^help[\s!.?]*$/.test(text)) return true;

  // Capability / help / meta questions about what the agent itself can do.
  if (/\bwhat\s+can\s+you\s+do\b/.test(text)) return true;
  if (/\bwhat\s+are\s+you\s+(?:able\s+to\s+do|capable\s+of)\b/.test(text)) return true;
  if (/\b(?:capable\s+of|your\s+capabilities)\b/.test(text)) return true;
  if (/\bare\s+you\s+able\s+to\b/.test(text)) return true;
  if (/\bdo\s+you\s+have\s+(?:the\s+)?(?:capability|capabilities|ability|permission|permissions)\b/.test(text)) {
    return true;
  }
  if (/\bwhich\s+(?:sections|things|records|files|data|kinds?|types?)\s+can\s+you\b/.test(text)) {
    return true;
  }

  // "can you ..." / "could you ..." asking about a generic ops capability
  // rather than a specific named record. A trailing "?" is not required —
  // users routinely phrase capability checks as statements ("can you make a
  // task"). The genericOpsTarget / concreteRecordCue split still keeps
  // requests about a specific named record ("can you delete the #418 task")
  // subject to the backstop.
  if (/^(?:can|could)\s+you\b/.test(text)) {
    const genericOpsTarget =
      /\b(?:property\s+(?:profile|profiles|information|knowledge)|profiles?|tasks?|attachments?|documents?|photos?|videos?|files?|notes?|vendors?|contacts?|access|connectivity|interior|exterior|activity)\b/.test(text);
    const concreteRecordCue =
      /\b(?:\d{3,}|#\d+|called|named|titled|for\s+\d|at\s+\d)\b/.test(text);
    return genericOpsTarget && !concreteRecordCue;
  }

  // Meta-conversation: the user is asking about the conversation itself
  // (what they just asked, what the agent said, what was discussed). The
  // model resolves these from the visible chat history — there's no live
  // record to look up, so the read-claim mask must stand down even though
  // no tool fires. Anchor patterns on "you" / "we" referring to the agent
  // or the conversation, so questions about live people ("did Billy ask
  // me to fix the light") still go through the mask.
  if (
    /\b(?:i|we)\s+(?:just|recently|earlier|previously|last|already)?\s*(?:ask(?:ed)?|told|said|wrote|mentioned|requested|wanted)\s+(?:you|foreshadow|the\s+bot|claude)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\bwhat\s+(?:was|were|is|are)\s+the\s+(?:last|previous|recent)\s+(?:thing|question|request|message|reply|response)/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\bwhat\s+did\s+(?:you|i|we)\s+(?:just|recently|earlier|previously|last|already)?\s*(?:say|said|tell\s+me|mention|reply|respond|ask|request)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\byou\s+(?:just|recently|earlier|previously|last|already)?\s*(?:said|told\s+me|mentioned|sent|wrote|replied|responded)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (/\bremind\s+me\s+(?:what|when|how|why)\b/.test(text)) return true;
  if (
    /\bour\s+(?:conversation|chat|discussion|thread|exchange)\b/.test(text)
  ) {
    return true;
  }
  if (
    /\bhave\s+(?:we|you)\s+(?:talked|discussed|been\s+doing|covered|gone\s+over)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:summari[sz]e|recap)\s+(?:our|the|this)\s+(?:conversation|chat|discussion|thread)\b/.test(
      text,
    )
  ) {
    return true;
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
  if (isNonDataLookupPrompt(prompt)) {
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
