import type { Block } from '@slack/types';
import { buildAssignmentBlocks } from '@/src/slack/assignmentBlocks';
import { getMyAssignmentsData } from '@/src/server/commands/myAssignments';

// Handler for the `/myassignments` Slack slash command.
//
// Why this exists separately from the agent: the question — "what tasks am I
// currently assigned to?" — is fully deterministic, so routing it through the
// LLM would add latency, cost, and hallucination risk for zero gain.
//
// The data-fetching and filtering/sorting rules live in the surface-agnostic
// src/server/commands/myAssignments.ts (shared with the in-app chat command).
// This handler is just the Slack rendering shell.

export interface MyAssignmentsResult {
  /** Plain-text fallback / notification body and the 0-results message. */
  text: string;
  /**
   * Block Kit payload: `header` + one top-level `card` per task. Empty when
   * the user has no open assignments — the route falls back to `text`.
   */
  blocks: Block[];
}

/**
 * Run the /myassignments query for an already-resolved app user and return
 * the Slack-shaped response payload.
 */
export async function runMyAssignments(args: {
  appUserId: string;
  displayName: string;
}): Promise<MyAssignmentsResult> {
  const { appUserId, displayName } = args;

  const data = await getMyAssignmentsData(appUserId);
  if (!data.ok) {
    return {
      text: `Sorry — I couldn't load your assignments right now. Try again in a moment.`,
      blocks: [],
    };
  }
  if (data.tasks.length === 0) {
    return {
      text: `${displayName}, you have no open assignments. Nice.`,
      blocks: [],
    };
  }

  const blocks = buildAssignmentBlocks(data.tasks);
  const noun = data.tasks.length === 1 ? 'assignment' : 'assignments';
  const text = `${displayName}, you have ${data.tasks.length} open ${noun}.`;

  return { text, blocks };
}
