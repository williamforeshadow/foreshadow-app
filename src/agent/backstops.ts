import type { ToolCallTrace } from './runAgent';
import { WRITE_TOOL_NAMES } from './runAgent';

// Hallucination backstops.
//
// We keep only the write-claim mask — it has real teeth because writes
// have side effects, and "I created/updated/deleted X" with no successful
// write tool is unambiguously bad.
//
// The read-claim mask was removed: it predated `temperature: 0` and the
// identifier/linking rules, both of which now do the heavy lifting at the
// model level. In practice the read mask was masking legitimate answers
// (formatted enumerations from real tool results, meta-conversation
// recall from history) more often than it caught fabrication. If we ever
// see the model fabricate factual lists without tool calls at temp 0,
// we'll add a tighter, evidence-driven defense back here — but the
// catch-all heuristic was over-engineering.

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

export function applyBackstops(
  text: string,
  toolCalls: ToolCallTrace[],
  // The `_options` arg is retained for signature stability with callers
  // that previously passed { prompt } for the read-claim heuristic.
  _options: { prompt?: string } = {},
): {
  text: string;
  writeMasked: boolean;
  originalIfMasked?: string;
} {
  const w = maskHallucinatedWriteClaim(text, toolCalls);
  return {
    text: w.text,
    writeMasked: w.replaced,
    originalIfMasked: w.replaced ? text : undefined,
  };
}
