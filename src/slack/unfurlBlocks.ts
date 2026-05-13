import type { KnownBlock } from '@slack/types';

// Block Kit builders for the two task-card surfaces:
//
//   - taskUnfurl: classic block-list rendering for chat.unfurl. Used when
//     someone pastes a single task URL — Slack displays the result inline
//     under that one URL.
//
//   - taskCard: a single `card` element for use inside a `carousel` block.
//     Used when the bot replies with multiple tasks; the carousel scrolls
//     horizontally so 5–10 task cards stay compact instead of stacking
//     vertically. Above 10 tasks the bot drops the cards entirely and
//     leans on the agent's prose bullet list (see unfurl.ts).
//
// Both surfaces use the same slim layout — title (linked), property as
// subtitle, a single body line of "<status emoji> <status> · <due date>",
// and an "↗" action button (diagonal arrow as the open-in-Foreshadow
// glyph). We deliberately do NOT surface assignee / priority /
// description / department in the card; the user can click through for
// the full picture.

// Single-character button label used as the open-in-Foreshadow click
// target on every card surface (taskUnfurl, taskCard, and the
// assignmentCardBlock builder in assignmentBlocks.ts). Plain Unicode
// (U+2197 NORTH EAST ARROW) so it renders inside `plain_text` with
// `emoji: false` — no Slack emoji-shortcode conversion needed.
export const OPEN_BUTTON_LABEL = '\u2197';

export interface TaskForUnfurl {
  task_id: string;
  title: string | null;
  template_name: string | null;
  /** Free-text task description. Currently not rendered (cards stay slim). */
  description: string | null;
  /** Status enum value from turnover_tasks (e.g. 'in_progress'). */
  status: string;
  /** Priority enum value (e.g. 'high'). Currently not rendered. */
  priority: string;
  /** Property the task is associated with — appears as the subtitle. */
  property_name: string | null;
  /** Department label. Currently not rendered. */
  department_name: string | null;
  /** Bin the task lives in. Falls back into the subtitle when no property. */
  bin_name: string | null;
  /** YYYY-MM-DD wall-clock date; null when unscheduled. */
  scheduled_date: string | null;
  /** HH:MM[:SS] wall-clock time; null when no specific time set. */
  scheduled_time: string | null;
  /** Assignees. Currently not rendered. */
  assigned_users: Array<{ user_id: string; name: string }>;
  /**
   * Absolute task URL. Used as the click target for the title and the
   * action button. Caller passes the same URL that arrived from Slack so
   * deep-links round-trip cleanly even if APP_BASE_URL drifts later.
   */
  task_url: string;
}

export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
  contingent: 'Contingent',
};

// Visual indicator that survives across Slack themes / dark mode.
// Slack mrkdwn doesn't support text color so emoji is the only way to
// give the status field a glanceable color cue.
export const STATUS_EMOJI: Record<string, string> = {
  not_started: '⚪',
  in_progress: '🔵',
  paused: '⏸️',
  complete: '🟢',
  contingent: '🟡',
};

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatStatus(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

function statusEmoji(s: string): string {
  return STATUS_EMOJI[s] ?? '⚫';
}

// Format YYYY-MM-DD as "Mon D, YYYY" without going through Date — these are
// wall-clock dates with no real timezone and we don't want JS's Date parser
// silently shifting them by the runtime offset.
//
// Exported so the streaming-chunk builder (streamChunks.ts) can reuse the
// exact same date format the carousel and unfurl cards already use, keeping
// "Scheduled: …" lines consistent across surfaces.
export function formatScheduled(
  date: string | null,
  time: string | null,
): string | null {
  if (!date) return null;
  const parts = date.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return date;
  const [y, m, d] = parts;
  const monthName = MONTH_NAMES[m - 1] ?? '';
  const datePart = `${monthName} ${d}, ${y}`;
  if (!time) return datePart;
  return `${datePart} · ${formatTime(time)}`;
}

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = Number(hStr);
  if (Number.isNaN(h)) return t;
  const mins = mStr ?? '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mins} ${ampm}`;
}

// Slack mrkdwn treats `&`, `<`, and `>` as control characters. Anything that
// goes into a TextObject must be HTML-entity-escaped or it can break the
// rendering — e.g. a property name containing "&" would otherwise be
// reinterpreted as the start of an entity.
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Compute the slim visual fields shared by both rendering surfaces.
function computeCardFields(task: TaskForUnfurl): {
  title: string;
  subtitle: string;
  bodyLine: string;
} {
  const title =
    task.title?.trim() || task.template_name?.trim() || 'Untitled task';

  const subtitleParts: string[] = [];
  if (task.property_name) subtitleParts.push(task.property_name);
  else if (task.bin_name) subtitleParts.push(task.bin_name);
  const subtitle = subtitleParts.join(' · ');

  const bodyParts: string[] = [];
  bodyParts.push(`${statusEmoji(task.status)} ${formatStatus(task.status)}`);
  const due = formatScheduled(task.scheduled_date, task.scheduled_time);
  if (due) bodyParts.push(due);
  const bodyLine = bodyParts.join('  ·  ');

  return { title, subtitle, bodyLine };
}

/**
 * Build the Block Kit blocks for a single-URL chat.unfurl. Slim layout:
 * bold linked title, subtitle context line, one body line with status +
 * due date, and an "↗" button.
 */
export function taskUnfurl(task: TaskForUnfurl): { blocks: KnownBlock[] } {
  const { title, subtitle, bodyLine } = computeCardFields(task);
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*<${task.task_url}|${escapeMrkdwn(title)}>*`,
    },
  });

  if (subtitle) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: escapeMrkdwn(subtitle) }],
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: bodyLine },
  });

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: OPEN_BUTTON_LABEL, emoji: false },
        url: task.task_url,
      },
    ],
  });

  return { blocks };
}

// `card` and `carousel` are newer Slack blocks (Slack platform 2025) that
// the @slack/types package doesn't yet model. We define a local interface
// so our builder is type-safe at the boundary, then cast to AnyBlock when
// actually handing it to chat.postMessage. When the SDK adds first-class
// types we just drop these and import.
export interface SlackCardElement {
  type: 'card';
  block_id?: string;
  title?: { type: 'mrkdwn' | 'plain_text'; text: string; verbatim?: boolean };
  subtitle?: {
    type: 'mrkdwn' | 'plain_text';
    text: string;
    verbatim?: boolean;
  };
  body?: { type: 'mrkdwn' | 'plain_text'; text: string; verbatim?: boolean };
  actions?: Array<{
    type: 'button';
    text: { type: 'plain_text'; text: string; emoji?: boolean };
    url?: string;
    action_id?: string;
    style?: 'primary' | 'danger';
  }>;
}

export interface SlackCarouselBlock {
  type: 'carousel';
  block_id?: string;
  elements: SlackCardElement[];
}

// Streaming task chunks for /myassignments live in src/slack/streamChunks.ts.
// They use `task_update` chunks (not `task_card` blocks) because Slack's
// chat.postMessage rejects task_card with `invalid_blocks` — task_card
// is a streaming-only primitive emitted via chat.{start,append,stop}Stream.
// See streamChunks.ts for the chunk builders + the explanation.

/**
 * Build a single `card` element for use inside a Slack `carousel` block.
 * Same slim layout as taskUnfurl but expressed as one card object instead
 * of a list of section/context/actions blocks. The carousel itself wraps
 * up to 10 of these (Slack's per-carousel cap).
 *
 * Why the title is plain text (no `<url|text>` mrkdwn link):
 *   We tried wrapping the title in an mrkdwn link as a belt-and-
 *   suspenders second click target. It rendered LITERALLY as
 *   "<https://...|Task title>" because `card.title` doesn't parse
 *   mrkdwn link syntax — only inline styling marks (bold/italic) work
 *   here. The Slack carousel docs confirm this implicitly: their
 *   own examples never show link syntax in card.title. The "↗"
 *   action button is the single click target.
 *
 * Why the button has BOTH `url` and `action_id`:
 *   action_id is required for Slack to fire interactivity events on
 *   click (which our `/api/slack/interactivity` ack endpoint handles).
 *   Without action_id, button-click handling would be inconsistent
 *   across Slack clients. The action_id is structured `open_task_<uuid>`
 *   so future server-side handlers (e.g. "Mark complete from card")
 *   can pattern-match on it without needing a separate dispatch table.
 */
export function taskCard(
  task: TaskForUnfurl,
  options?: {
    bodyOverride?: string | null;
    /**
     * When set, a "Mark as read" button is appended next to the ↗ open button
     * with `action_id` = `notification_mark_read_<id>`. The interactivity
     * handler at `app/api/slack/interactivity/route.ts` dispatches on that
     * prefix to mark the notification read and chat.update the message back
     * without the mark-read button.
     */
    markReadNotificationId?: string | null;
  },
): SlackCardElement {
  const { title, subtitle, bodyLine } = computeCardFields(task);
  const finalBody =
    options?.bodyOverride && options.bodyOverride.trim()
      ? options.bodyOverride
      : bodyLine;

  const actions: NonNullable<SlackCardElement['actions']> = [
    {
      type: 'button',
      text: { type: 'plain_text', text: OPEN_BUTTON_LABEL, emoji: false },
      url: task.task_url,
      action_id: `open_task_${task.task_id}`,
    },
  ];
  if (options?.markReadNotificationId) {
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Mark as read', emoji: false },
      action_id: `notification_mark_read_${options.markReadNotificationId}`,
    });
  }

  return {
    type: 'card',
    block_id: `task-${task.task_id}`,
    title: {
      type: 'mrkdwn',
      text: escapeMrkdwn(title),
      verbatim: false,
    },
    ...(subtitle
      ? {
          subtitle: {
            type: 'mrkdwn',
            text: escapeMrkdwn(subtitle),
            verbatim: false,
          },
        }
      : {}),
    body: {
      type: 'mrkdwn',
      text: finalBody,
      verbatim: false,
    },
    actions,
  };
}
