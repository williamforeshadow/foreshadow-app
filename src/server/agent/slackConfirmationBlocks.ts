import type { Block } from '@slack/types';
import type { ToolCallTrace } from '@/src/agent/runAgent';
import {
  AGENT_CANCEL_ACTION_ID,
  AGENT_CONFIRM_ACTION_ID,
} from './pendingActions';

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

// Encode an ordered list of pending-action ids into a single Slack button
// `value` field. Comma-separated is short and trivial to parse on the
// interactivity-route side; Slack caps value at 2000 chars which fits
// ~54 UUIDs (well past any realistic preview count for one turn).
const ID_SEPARATOR = ',';

export function encodePendingActionIds(ids: string[]): string {
  return ids.join(ID_SEPARATOR);
}

export function decodePendingActionIds(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(ID_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Rebuild a posted message's blocks with the Confirm/Cancel pair removed and a
 * note of what was chosen in its place.
 *
 * Slack leaves buttons live and clickable forever; the pending-action claim
 * already stops a second click committing twice, but the buttons sitting there
 * afterwards read as "still waiting on you". Swapping them for a context line
 * makes the message show its own outcome.
 *
 * Returns the original blocks unchanged when there is nothing to strip.
 */
export function blocksWithoutConfirmation(
  blocks: Block[] | undefined,
  resolution: 'confirmed' | 'cancelled',
): Block[] {
  if (!blocks?.length) return [];
  const kept = blocks.filter(
    (b) => !isAgentConfirmationActions(b as unknown as Record<string, unknown>),
  );
  if (kept.length === blocks.length) return blocks;
  return [
    ...kept,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: resolution === 'confirmed' ? '_Confirmed._' : '_Cancelled._',
        },
      ],
    } as unknown as Block,
  ];
}

/** True for the actions block this module builds — not any actions block. */
function isAgentConfirmationActions(block: Record<string, unknown>): boolean {
  if (block?.type !== 'actions') return false;
  const elements = (block.elements ?? []) as Array<{ action_id?: string }>;
  return elements.some(
    (e) =>
      e?.action_id === AGENT_CONFIRM_ACTION_ID ||
      e?.action_id === AGENT_CANCEL_ACTION_ID,
  );
}

/**
 * Slack has no coloured text, so an outcome is signalled with an attachment's
 * left bar. Green means the write landed and terracotta means it didn't —
 * the same two signals the web chat uses, and the same values as the design
 * system's --task-green and --destructive.
 *
 * Emoji markers are deliberately not used: the agent is instructed never to
 * emit them (src/agent/skills/no-emojis.md), and result text is read as part
 * of the same conversation.
 */
export function buildResultAttachments(
  text: string,
  outcome: 'committed' | 'failed' | 'cancelled',
) {
  const color =
    outcome === 'committed'
      ? '#047857'
      : outcome === 'failed'
        ? '#d97757'
        : '#8a8a8a';
  return [
    {
      color,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    },
  ];
}

export function buildConfirmationBlocks(pendingActionIds: string[]): Block[] {
  const value = encodePendingActionIds(pendingActionIds);
  return [
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Confirm' },
          style: 'primary',
          action_id: AGENT_CONFIRM_ACTION_ID,
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          style: 'danger',
          action_id: AGENT_CANCEL_ACTION_ID,
          value,
        },
      ],
    } as unknown as Block,
  ];
}
