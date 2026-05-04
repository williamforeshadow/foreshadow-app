import type { Block, KnownBlock } from '@slack/types';
import type { TaskByIdRow } from '@/src/server/tasks/getTaskById';
import { OPEN_BUTTON_LABEL, type SlackCardElement } from './unfurlBlocks';

// Block Kit builder for the /myassignments slash-command response.
//
// Visual — TWO modes, gated on count:
//
//   1) ≤ MAX_ASSIGNMENT_CARDS tasks → header + one top-level `card`
//      block per assignment:
//        - title    = task title (mrkdwn, bold)
//        - subtitle = property name, or "No property" when neither
//                     property_name nor bin_name is set
//        - actions  = single "↗" button → task URL
//
//   2) > MAX_ASSIGNMENT_CARDS tasks → header + a single `section` block
//      with a Unicode bullet list, one task per line, each line a
//      Slack mrkdwn link `• <url|Title>`. No cards, no buttons. This
//      mirrors how the agent's prose responses already enumerate task
//      results (markdownToMrkdwn turns "- [Title](url)" into the same
//      "• <url|Title>" shape — see src/slack/format.ts).
//
// Why two modes:
//   The card layout looks great at small counts but visually overwhelms
//   the channel at high counts (tall, busy, slow to scan). The bullet
//   layout is the agent's proven "long list" affordance — compact,
//   each title still clickable via Slack's native link syntax, no
//   blocks-per-message budget to worry about.
//
// Why top-level `card` (mode 1):
//   @slack/types' KnownBlock union does NOT include a top-level `card`
//   (only `TaskCardBlock` and `PlanBlock`, both streaming-only). Slack
//   documents `card` as a `carousel` child element. We ship it
//   standalone via chat.postEphemeral; if Slack ever rejects the
//   payload it'll surface as `invalid_blocks` from the WebClient call.
//
// Click target on cards:
//   `card.title` does NOT parse `<url|label>` mrkdwn link syntax (it
//   renders the literal text — see unfurlBlocks.ts:240-248). The only
//   working click target on a card is an `actions[]` button with a
//   `url`. We add one "↗" button per card. The action_id is structured
//   `open_task_<uuid>` so the existing /api/slack/interactivity ack
//   handler can pattern-match on it later if we wire server-side
//   button behaviour.
//
// Block-count and text caps:
//   - Mode 1 produces 1 + N blocks (header + N cards). With
//     MAX_ASSIGNMENT_CARDS = 10 we top out at 11 blocks, well under
//     Slack's 50-block-per-message cap.
//   - Mode 2 produces exactly 2 blocks (header + section). Slack
//     caps `section.text` at 3000 chars; at ~70-90 chars per task
//     line we comfortably fit 30+ tasks before the cap matters. If
//     we ever see real users blow past that, split into multiple
//     section blocks in assignmentBulletSectionBlock.
//
// Contract:
//   - Title falls back to template_name → "Untitled task".
//   - Subtitle falls back to bin_name → "No property" (cards mode).
//   - All user-supplied strings are HTML-escaped for mrkdwn (`&`,
//     `<`, `>`).

const HEADER_TEXT = 'My Assignments';
const NO_PROPERTY_LABEL = 'No property';
// Threshold between cards mode and bullet-list mode. Matches the
// MAX_CAROUSEL_CARDS constant in unfurl.ts so both surfaces (agent
// path + /myassignments) switch to the lightweight bullet rendering
// at the same boundary.
const MAX_ASSIGNMENT_CARDS = 10;

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
 *   - actions:  a single "↗" URL button — the only working click
 *               target on a card block (card.title does not parse
 *               Slack mrkdwn link syntax)
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
        text: { type: 'plain_text', text: OPEN_BUTTON_LABEL, emoji: false },
        url,
        action_id: `open_task_${task.task_id}`,
      },
    ],
  };
}

/**
 * One section block carrying a Unicode-bullet list of tasks. Each line
 * is `• <url|Title>` — Slack's native link syntax, the same shape
 * markdownToMrkdwn produces for the agent's prose responses, so the
 * bullet rendering looks identical between /myassignments and the
 * agent's "you have N tasks" answers.
 *
 * The fallback title chain matches assignmentCardBlock so the same
 * task renders with the same label across both modes.
 *
 * Note: `section.text` has a 3000-char hard cap. We don't enforce it
 * here — at typical title lengths (~30-50 chars) we comfortably fit
 * 30+ tasks before the cap matters. If we ever see users blow past
 * that, split into multiple section blocks here.
 */
export function assignmentBulletSectionBlock(
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>,
): KnownBlock {
  const lines = orderedTasks.map(({ url, task }) => {
    const title =
      task.title?.trim() || task.template_name?.trim() || 'Untitled task';
    return `\u2022 <${url}|${escapeMrkdwn(title)}>`;
  });
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
  };
}

/**
 * Compose the full block list for a /myassignments response.
 *
 * Two modes (see file-top doc comment for the rationale):
 *   - ≤ MAX_ASSIGNMENT_CARDS → header + one top-level `card` per task
 *   - > MAX_ASSIGNMENT_CARDS → header + one bullet-list `section` block
 *
 * Returns an empty array when `orderedTasks` is empty — the route
 * layer handles the 0-results case as a plain-text ephemeral.
 *
 * Returns Block[] (not KnownBlock[]) because the cards path emits
 * top-level `card` blocks that aren't in @slack/types' KnownBlock
 * union. The bullet-list path uses only KnownBlock primitives but is
 * widened at the boundary for a uniform return type.
 */
export function buildAssignmentBlocks(
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>,
): Block[] {
  if (orderedTasks.length === 0) return [];
  const blocks: Block[] = [assignmentHeaderBlock() as unknown as Block];
  if (orderedTasks.length <= MAX_ASSIGNMENT_CARDS) {
    for (const row of orderedTasks) {
      blocks.push(assignmentCardBlock(row) as unknown as Block);
    }
  } else {
    blocks.push(assignmentBulletSectionBlock(orderedTasks) as unknown as Block);
  }
  return blocks;
}
