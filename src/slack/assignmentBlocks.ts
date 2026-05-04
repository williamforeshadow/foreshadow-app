import type { Block, KnownBlock } from '@slack/types';
import type { TaskByIdRow } from '@/src/server/tasks/getTaskById';
import type { SlackCardElement } from './unfurlBlocks';

// Block Kit builder for the /myassignments slash-command response.
//
// Visual:
//   - One `header` block at the top: "My Assignments"
//   - One top-level `card` block per assignment:
//       - title    = task title (mrkdwn, bold)
//       - subtitle = property name, or "No property" when neither
//                    property_name nor bin_name is set
//       - actions  = single "Open in Foreshadow" button → task URL
//
// Why top-level `card` (instead of `section` blocks or a `carousel`):
//   This is an experimental layout. @slack/types' KnownBlock union does
//   NOT include a top-level `card` (only `TaskCardBlock` and `PlanBlock`,
//   both streaming-only). Slack's reference documents `card` as a
//   `carousel` child element. So whether `chat.postMessage` /
//   `chat.postEphemeral` accept a top-level `card` is undocumented and
//   was never tested in this codebase before.
//
//   If Slack rejects the payload it'll come back as `invalid_blocks`
//   from the WebClient call — fast, loud, easy to fall back from. If
//   it renders, this gives us a per-task card UI with no carousel cap
//   and no thread requirement.
//
// Click target:
//   `card.title` does NOT parse `<url|label>` mrkdwn link syntax (it
//   renders the literal text — see unfurlBlocks.ts:239-247). The only
//   working click target on a card is an `actions[]` button with a
//   `url`. We add one "Open in Foreshadow" button per card. The
//   action_id is structured `open_task_<uuid>` so the existing
//   /api/slack/interactivity ack handler can pattern-match on it
//   later if we wire server-side button behaviour.
//
// Block-count cap:
//   Slack caps a single message at 50 blocks. With 1 header block we
//   have headroom for 49 cards. Truncate beyond that — extremely rare
//   in practice (a single user with 50+ open assignments is a sign
//   their workload, not the renderer, needs attention).
//
// Contract:
//   - Title falls back to template_name → "Untitled task".
//   - Subtitle falls back to bin_name → "No property".
//   - All user-supplied strings are HTML-escaped for mrkdwn (`&`,
//     `<`, `>`).

const HEADER_TEXT = 'My Assignments';
const NO_PROPERTY_LABEL = 'No property';
// Slack's per-message block cap is 50. Reserve 1 slot for the header.
const MAX_ASSIGNMENT_CARDS = 49;

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
 * One top-level `card` block for one assignment. Layout:
 *   - title:    bold task title (mrkdwn `*…*`)
 *   - subtitle: property name, or "No property" if no property and no
 *               bin is attached
 *   - actions:  a single "Open in Foreshadow" URL button — the only
 *               working click target on a card block (card.title does
 *               not parse Slack mrkdwn link syntax)
 */
export function assignmentCardBlock(args: {
  task: TaskByIdRow;
  url: string;
}): SlackCardElement {
  const { task, url } = args;

  const title =
    task.title?.trim() || task.template_name?.trim() || 'Untitled task';
  const place =
    task.property_name?.trim() || task.bin_name?.trim() || NO_PROPERTY_LABEL;

  return {
    type: 'card',
    block_id: `assignment-${task.task_id}`,
    title: {
      type: 'mrkdwn',
      text: `*${escapeMrkdwn(title)}*`,
      verbatim: false,
    },
    subtitle: {
      type: 'mrkdwn',
      text: escapeMrkdwn(place),
      verbatim: false,
    },
    actions: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Foreshadow', emoji: false },
        url,
        action_id: `open_task_${task.task_id}`,
      },
    ],
  };
}

/**
 * Compose the full block list for a /myassignments response: header
 * followed by one top-level `card` block per task, in the order given.
 *
 * Truncates to MAX_ASSIGNMENT_CARDS so the message stays under Slack's
 * 50-block cap. Returns an empty array when `orderedTasks` is empty —
 * the route layer handles the 0-results case as a plain-text ephemeral.
 *
 * Returns Block[] (not KnownBlock[]) because @slack/types' KnownBlock
 * union doesn't include a top-level `card` block. We cast at the
 * boundary; if Slack accepts the payload at runtime, this is the
 * intended shape. If it rejects with `invalid_blocks`, that's the
 * signal to fall back to a different layout.
 */
export function buildAssignmentBlocks(
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>,
): Block[] {
  if (orderedTasks.length === 0) return [];
  const blocks: Block[] = [assignmentHeaderBlock() as unknown as Block];
  const capped = orderedTasks.slice(0, MAX_ASSIGNMENT_CARDS);
  for (const row of capped) {
    blocks.push(assignmentCardBlock(row) as unknown as Block);
  }
  return blocks;
}
