import type { ToolCallTrace } from './runAgent';
import { WRITE_TOOL_NAMES } from './runAgent';

// Hallucination backstops.
//
// Two complementary checks that run AFTER the model has produced its final
// text but BEFORE it reaches the user. Each detects a specific shape of
// fabrication and replaces the response with a safe message, so we never
// leak a confident-sounding lie even when the model goes off-script.
//
// Both backstops are surface-agnostic — they take only the model's text
// and the tool-call trace, and return a possibly-replaced text plus a
// `replaced` flag the caller uses for logging and metadata. The web chat
// route and the Slack route both call them in the same order: write-claim
// first (more specific), read-claim second.

// First-person past-tense action claims OR "has been [verb]" passive claims.
// Tuned tight enough to skip find_tasks descriptive output ("the task was
// created on May 1") while catching the hallucination patterns we've seen
// in practice ("I've created the task", "the task has been scheduled").
const ACTION_CLAIM_RE =
  /\b(?:I(?:'ve|\s+have)?\s+(?:created|scheduled|assigned|updated|deleted|cancelled|completed|marked)|has\s+been\s+(?:created|scheduled|updated|deleted|cancelled|completed))\b/i;

/**
 * If the model claims an action happened but no write tool was called
 * successfully this turn, replace its reply with a safe error message and
 * log the original for diagnosis. This is a last-resort backstop for the
 * case where the system prompt's action-claim rule fails to hold.
 *
 * Note: when allowWrites is false (e.g. on Slack), the write tool list is
 * still the same — but the model couldn't have invoked any of them, so
 * any action claim definitionally fails this check. That's intentional;
 * the model should not be claiming side effects on a read-only surface.
 */
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
    text: "I started to take that action but didn't actually run the right tool, so nothing was changed. Please try again — feel free to be more specific about what you want me to do.",
    replaced: true,
    original: text,
  };
}

// Tools that fetch real data. If a response presents structured factual
// content but none of these were called successfully this turn, the model
// is making things up.
const READ_TOOL_PREFIXES = ['find_', 'get_'];

function isReadTool(name: string): boolean {
  return READ_TOOL_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Heuristic for "this looks like a structured data answer." Fires on any
 * of these patterns:
 *   - 3+ numbered list items ("1. Foo\n2. Bar\n3. Baz")
 *   - 3+ markdown bullet points
 *   - 2+ markdown ## or ### section headers
 *   - 3+ "**Label**:" bold-labeled facts
 * These patterns dominate the hallucination shapes we've seen ("Here are
 * 26 templates: ## Cleaning Templates (11): 1. ... 2. ..."). Conversational
 * replies, short clarifying questions, and one-off summaries don't trip
 * any of them.
 */
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

/**
 * If the model produced a data-shaped answer (lists, headers, labeled
 * facts) but no read tool was called successfully this turn, the response
 * is fabricated. Replace with a safe message and log. Complements the
 * write-claim backstop — they handle different failure modes and can be
 * applied independently.
 */
export function maskHallucinatedReadClaim(
  text: string,
  toolCalls: ToolCallTrace[],
): { text: string; replaced: boolean; original?: string } {
  if (!looksLikeDataAnswer(text)) {
    return { text, replaced: false };
  }
  // Any successful tool call grounds the response: read tools provide the
  // data being rendered; write tools' return rows ground the confirmation.
  // Only mask when zero tools succeeded this turn.
  const anyToolSucceeded = toolCalls.some(
    (c) => c.output.ok === true && (isReadTool(c.name) || WRITE_TOOL_NAMES.has(c.name)),
  );
  if (anyToolSucceeded) {
    return { text, replaced: false };
  }
  return {
    text: "I started to look that up but didn't actually call a tool to fetch the data, so I can't trust what I'd say. Try asking again, or be more specific about what you're looking for.",
    replaced: true,
    original: text,
  };
}

/**
 * Apply both backstops in order (write-claim then read-claim) and return
 * the final text plus per-backstop replaced flags. Caller decides how to
 * log/persist the flags. Order matters: write-claim is the more specific
 * signal; once it fires the masked text has no list/header structure so
 * read-claim won't double-fire on the same response.
 */
export function applyBackstops(
  text: string,
  toolCalls: ToolCallTrace[],
): {
  text: string;
  writeMasked: boolean;
  readMasked: boolean;
  originalIfMasked?: string;
} {
  const w = maskHallucinatedWriteClaim(text, toolCalls);
  const r = maskHallucinatedReadClaim(w.text, toolCalls);
  return {
    text: r.text,
    writeMasked: w.replaced,
    readMasked: r.replaced,
    originalIfMasked: w.replaced || r.replaced ? text : undefined,
  };
}
