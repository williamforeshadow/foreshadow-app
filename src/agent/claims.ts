import type { ToolCallTrace } from './dispatchTool';

// Claims the model can make that the server can mechanically check.
//
// Lives in its own module because two layers need the same definition and an
// import cycle sits between them: backstops.ts imports WRITE_TOOL_NAMES from
// runAgent.ts, so runAgent.ts cannot import back out of backstops.ts. Both
// import from here instead.
//
// The two layers are deliberately different in kind:
//   - runAgent self-corrects. It notices the bad claim before the user ever
//     sees it and takes another turn to make the claim true.
//   - backstops mask. They run after the loop has given up, and replace the
//     message.
// Retry first, mask only if the retry also failed.

/**
 * Does this reply point the user at a Confirm/Cancel button?
 *
 * Matches "Confirm below to create it", "Confirm or Cancel below", "press
 * Confirm", "use the buttons below". Deliberately does NOT match bare
 * references to content further down the message ("the tasks below", "listed
 * below") — those are ordinary prose and carry no promise about state.
 */
const BUTTON_CLAIM_RE =
  /\b(?:confirm|cancel)\b[^.!?\n]{0,30}\bbelow\b|\b(?:press|tap|hit|click|use)\s+(?:the\s+)?(?:["'*_]*(?:confirm|cancel)\b|buttons?\b)/i;

export function claimsConfirmButton(text: string): boolean {
  return BUTTON_CLAIM_RE.test(text);
}

/**
 * The pending-action ids registered by preview tools during a run, in call
 * order and deduped.
 *
 * This is the single definition of "will a Confirm button actually render" —
 * the routes render their buttons from this list, and both the self-correction
 * in runAgent and the phantom-button mask ask it the same question.
 */
export function extractPendingActionIds(toolCalls: ToolCallTrace[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const call of toolCalls) {
    if (!call.output.ok) continue;
    const data = call.output.data;
    if (!data || typeof data !== 'object') continue;
    const id = (data as { pending_action_id?: unknown }).pending_action_id;
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }
  return ids;
}
