import type { ToolCallTrace } from './runAgent';
import { WRITE_TOOL_NAMES } from './runAgent';

// Hallucination backstops.
//
// Two masks, both keyed on claims that are mechanically falsifiable:
//   - write-claim: "I created/updated/deleted X" with no successful write tool.
//   - phantom-button: "Confirm below" when the turn registered no pending
//     action, so no button will render.
//
// The pairing is deliberate. Both are promises about state the user cannot
// verify from the message itself, and in both cases the server already knows
// the truth. Heuristics about whether an ANSWER is right belong nowhere near
// this file (see the removed read-claim mask below); heuristics about whether
// a claimed SIDE EFFECT happened are exactly what belongs here.
//
// The read-claim mask was removed: it predated `temperature: 0` and the
// identifier/linking rules. NOTE: temperature 0 is no longer available — the
// current model rejects non-default sampling parameters — so the identifier/
// linking rules now carry that load alone. If fabricated read-claims reappear,
// this is the first place to look. In practice the read mask was masking legitimate answers
// (formatted enumerations from real tool results, meta-conversation
// recall from history) more often than it caught fabrication. If we ever
// see the model fabricate factual lists without tool calls,
// we'll add a tighter, evidence-driven defense back here — but the
// catch-all heuristic was over-engineering.

const ACTION_CLAIM_RE =
  /\b(?:I(?:'ve|\s+have)?\s+(?:created|scheduled|assigned|updated|deleted|cancelled|completed|marked)|has\s+been\s+(?:created|scheduled|updated|deleted|cancelled|completed))\b/i;

// Forward-looking sibling of ACTION_CLAIM_RE: "Confirm below to create it",
// "press Confirm", "use the buttons below". ACTION_CLAIM_RE is past-tense only,
// so a message that promises a button rather than claiming a completed write
// sailed straight through it.
//
// That gap had teeth. On 2026-08-05 the agent answered a task request with a
// correct-looking plan ending "Confirm below to create it" — having called
// only find_properties. No preview tool ran, so no pending action existed and
// no buttons rendered. The user sat waiting under a message that looked like
// success, then gave up and re-asked two minutes later.
//
// Claiming a button is exactly as falsifiable as claiming a write, and cheaper
// to check: either the turn registered pending action ids or it did not.
const BUTTON_CLAIM_RE =
  /\b(?:confirm|cancel)\b[^.!?\n]{0,30}\bbelow\b|\b(?:press|tap|hit|click|use)\s+(?:the\s+)?(?:["'*_]*(?:confirm|cancel)\b|buttons?\b)/i;

/**
 * Replace a reply that tells the user to press a Confirm button when this turn
 * registered no pending action, so no button exists.
 *
 * `pendingActionIds` must be the list the caller is actually going to render
 * from — post-suppression, not the raw extraction. A turn that already
 * committed has its ids zeroed out, and in that case there is genuinely no
 * button to point at either.
 */
export function maskPhantomButtonClaim(
  text: string,
  pendingActionIds: string[],
): { text: string; replaced: boolean; original?: string } {
  if (pendingActionIds.length > 0) return { text, replaced: false };
  if (!BUTTON_CLAIM_RE.test(text)) return { text, replaced: false };

  return {
    text: "I described that plan but didn't actually stage it, so there are no Confirm buttons below and nothing has been created. Tell me to go ahead and I'll set it up properly.",
    replaced: true,
    original: text,
  };
}

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
  options: {
    /** Retained for signature stability with the old read-claim heuristic. */
    prompt?: string;
    /**
     * The pending action ids this turn will actually render buttons from.
     * Pass the post-suppression list. Omit only if the surface has no button
     * affordance at all — omitting it disables the phantom-button check.
     */
    pendingActionIds?: string[];
  } = {},
): {
  text: string;
  writeMasked: boolean;
  buttonMasked: boolean;
  originalIfMasked?: string;
} {
  const w = maskHallucinatedWriteClaim(text, toolCalls);
  if (w.replaced) {
    return {
      text: w.text,
      writeMasked: true,
      buttonMasked: false,
      originalIfMasked: text,
    };
  }

  // Only reachable when the write claim passed, so the two masks never fight
  // over the same message.
  const b = options.pendingActionIds
    ? maskPhantomButtonClaim(w.text, options.pendingActionIds)
    : { text: w.text, replaced: false as const };

  return {
    text: b.text,
    writeMasked: false,
    buttonMasked: b.replaced,
    originalIfMasked: b.replaced ? text : undefined,
  };
}
