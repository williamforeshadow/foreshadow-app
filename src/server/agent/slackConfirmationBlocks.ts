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

export function buildConfirmationBlocks(pendingActionId: string): Block[] {
  return [
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Confirm' },
          style: 'primary',
          action_id: AGENT_CONFIRM_ACTION_ID,
          value: pendingActionId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          style: 'danger',
          action_id: AGENT_CANCEL_ACTION_ID,
          value: pendingActionId,
        },
      ],
    } as unknown as Block,
  ];
}
