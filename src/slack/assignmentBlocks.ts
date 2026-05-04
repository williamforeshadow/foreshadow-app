import type { KnownBlock } from '@slack/types';
import type { TaskByIdRow } from '@/src/server/tasks/getTaskById';
import { formatScheduled } from './unfurlBlocks';

// Block Kit builder for the /myassignments slash-command response.
//
// Visual:
//   - One `header` block at the top: "My Assignments"
//   - One `section` block per assignment, with the task title as a
//     native mrkdwn hyperlink and a second line of "Property: …  ·
//     Scheduled: …" (each piece omitted when missing).
//
// Why plain blocks (and not task_card / carousel):
//   We tried the alternatives. Each failed in a specific way:
//     - task_card via chat.postMessage    → invalid_blocks (task_card
//                                            is streaming-only)
//     - task_update via chat.startStream  → works, but requires
//                                            thread_ts, so the rows
//                                            live one tap away inside
//                                            a thread — not inline
//     - carousel-of-card                  → renders, but card.actions[]
//                                            url buttons fail to
//                                            navigate on ephemeral and
//                                            on slash-command DMs
//
//   Plain section blocks with mrkdwn `<url|label>` link syntax are
//   the only path that satisfies all three of: inline rendering, no
//   thread, and reliably clickable links. We give up the expandable-
//   row affordance to get those.
//
// Contract:
//   - Title falls back to template_name → "Untitled task" so a
//     missing title never produces a bare/blank link.
//   - Property falls back to bin_name when the task has no property
//     attachment (matches the carousel/unfurl card behaviour).
//   - Scheduled falls back to the date alone when no time is set.
//   - All user-supplied strings are HTML-escaped for mrkdwn (`&`,
//     `<`, `>`) so a property name containing those characters
//     can't break Slack's rendering.

const HEADER_TEXT = 'My Assignments';

// Slack mrkdwn treats `&`, `<`, `>` as control characters. Anything
// dropped into a TextObject must be HTML-entity-escaped or it can
// either re-interpret as the start of a Slack-link (`<url|label>`)
// or get dropped silently. Same escape used by unfurlBlocks.ts.
function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The "My Assignments" header block. Rendered as a single h-style
 * line at the top of the ephemeral. Plain text only (header blocks
 * don't accept mrkdwn — the field literally requires `plain_text`).
 */
export function assignmentHeaderBlock(): KnownBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: HEADER_TEXT, emoji: true },
  };
}

/**
 * One section block for one assignment. Two-line layout:
 *   - Line 1: bold title wrapped in a Slack mrkdwn link (`<url|title>`)
 *   - Line 2: "Property: …  ·  Scheduled: …", with each piece omitted
 *             when missing. If both are missing the line is dropped
 *             entirely.
 */
export function assignmentSectionBlock(args: {
  task: TaskByIdRow;
  url: string;
}): KnownBlock {
  const { task, url } = args;

  const title =
    task.title?.trim() || task.template_name?.trim() || 'Untitled task';

  // Build the metadata line. Skip pieces that have no value rather
  // than rendering "Property: —" filler.
  const subParts: string[] = [];
  const place = task.property_name?.trim() || task.bin_name?.trim();
  if (place) subParts.push(`Property: ${escapeMrkdwn(place)}`);
  const scheduled = formatScheduled(task.scheduled_date, task.scheduled_time);
  if (scheduled) subParts.push(`Scheduled: ${scheduled}`);
  const secondLine = subParts.join('  ·  ');

  // Compose the mrkdwn body. `<url|label>` is Slack's native link
  // form — proven to render as a clickable hyperlink across every
  // surface (DM, channel, ephemeral, thread). Bold via `*…*` so the
  // title pops vs the metadata line.
  const titleLink = `*<${url}|${escapeMrkdwn(title)}>*`;
  const body = secondLine ? `${titleLink}\n${secondLine}` : titleLink;

  return {
    type: 'section',
    text: { type: 'mrkdwn', text: body },
  };
}

/**
 * Compose the full block list for a /myassignments response: header
 * followed by one section per task, in the order given.
 *
 * Returns an empty array when `orderedTasks` is empty — the route
 * layer handles the 0-results case as a plain-text ephemeral, no
 * blocks needed.
 */
export function buildAssignmentBlocks(
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>,
): KnownBlock[] {
  if (orderedTasks.length === 0) return [];
  const blocks: KnownBlock[] = [assignmentHeaderBlock()];
  for (const row of orderedTasks) {
    blocks.push(assignmentSectionBlock(row));
  }
  return blocks;
}
