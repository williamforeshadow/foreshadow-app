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
