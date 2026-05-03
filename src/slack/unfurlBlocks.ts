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
//     vertically as separate attachments.
//
// Both surfaces use the same slim layout — title (linked), property as
// subtitle, a single body line of "<status emoji> <status> · <due date>",
// and an "Open in Foreshadow" action button. We deliberately do NOT
// surface assignee / priority / description / department in the card; the
// user can click through for the full picture.

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

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
  contingent: 'Contingent',
};

// Visual indicator that survives across Slack themes / dark mode.
// Slack mrkdwn doesn't support text color so emoji is the only way to
// give the status field a glanceable color cue.
const STATUS_EMOJI: Record<string, string> = {
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
function formatScheduled(
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
function escapeMrkdwn(s: string): string {
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
 * due date, and an "Open in Foreshadow" button.
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
        text: { type: 'plain_text', text: 'Open in Foreshadow' },
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

// `task_card` is Slack's newer Block Kit primitive (Slack platform 2025)
// designed for AI / agent surfaces — see
// https://docs.slack.dev/reference/block-kit/blocks/task-card-block
//
// Compared to `carousel`-of-`card`, the visual is fundamentally different:
//   - Each task_card renders as its own collapsible row in the message
//     (vertical list, not horizontal scroll). Click the row to expand.
//   - The expanded view shows `details` (rich_text), `output` (rich_text),
//     and `sources` (clickable URL chips). Sources are NATIVE Slack
//     hyperlinks — no button-with-url ambiguity, they always navigate.
//   - Status is a first-class enum that Slack renders as a coloured dot
//     next to the title (pending / in_progress / complete / error).
//
// We use this for /myassignments specifically because:
//   - It scales gracefully past the 10-card carousel cap.
//   - The "click a link" affordance lives in `sources`, which is the
//     proven-working transport for clickable URLs across DM, channel,
//     and ephemeral surfaces — bypassing the carousel-card-button gap
//     we hit on chat.postEphemeral and DM-only-blocks.
//   - The compact-row-then-expand interaction matches "scan a list,
//     drill into one" better than horizontal carousel scroll for
//     personal task lists.
//
// @slack/types 2.20.1 doesn't model task_card or rich_text yet, so the
// interfaces below are minimal local mirrors of the documented shape.
// We cast to `Block` at the chat.postMessage boundary; Slack accepts
// the JSON shape directly. When the SDK adds these types we can drop
// the locals.

export interface SlackTaskCardSource {
  type: 'url';
  url: string;
  text: string;
}

// Minimal rich_text element vocabulary — enough for what task_card.details
// actually wants (line-broken sections of plain + bold text, optional
// inline links). Skipping the full grammar (lists, quotes, code blocks)
// because card details are short structured metadata, not prose.
export interface SlackRichTextElement {
  type: 'text';
  text: string;
  style?: { bold?: boolean; italic?: boolean; code?: boolean };
}
export interface SlackRichTextLinkElement {
  type: 'link';
  url: string;
  text?: string;
  style?: { bold?: boolean; italic?: boolean };
}
export interface SlackRichTextSection {
  type: 'rich_text_section';
  elements: Array<SlackRichTextElement | SlackRichTextLinkElement>;
}
export interface SlackRichTextBlock {
  type: 'rich_text';
  elements: SlackRichTextSection[];
}

export interface SlackTaskCardBlock {
  type: 'task_card';
  task_id: string;
  /** Plain text — task_card.title is NOT mrkdwn (no `<url|label>` parsing). */
  title: string;
  /** Slack's enum is closed; map our wider status set onto these four. */
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  block_id?: string;
  details?: SlackRichTextBlock;
  output?: SlackRichTextBlock;
  sources?: SlackTaskCardSource[];
}

// Map Foreshadow's task status enum onto Slack's task_card status enum.
// Slack only models four states (pending / in_progress / complete / error);
// our paused + contingent get folded into pending because there's no
// closer match. /myassignments filters out complete tasks before this
// runs, so in practice we only emit pending or in_progress.
function toTaskCardStatus(
  s: string,
): 'pending' | 'in_progress' | 'complete' | 'error' {
  switch (s) {
    case 'in_progress':
      return 'in_progress';
    case 'complete':
      return 'complete';
    case 'not_started':
    case 'paused':
    case 'contingent':
    default:
      return 'pending';
  }
}

/**
 * Build a single `task_card` block for a Foreshadow task.
 *
 * Layout (when collapsed): coloured status dot + the task title.
 * Layout (when expanded): the title row plus
 *   - `details`: a rich_text block with one line per piece of metadata
 *     we want surfaced (property, scheduled date). Each rich_text_section
 *     renders on its own line.
 *   - `sources`: a single "Open in Foreshadow" URL chip pointing at the
 *     in-app task page. Slack renders these as native hyperlinks — the
 *     reliable click-through surface for task_card.
 *
 * What we deliberately omit:
 *   - `output`: meant for agent-task results ("Found 5 weather sources").
 *     Doesn't apply to a static list of assignments — there's no "result".
 *   - description / assignees / priority: we keep cards slim. The full
 *     picture is one click away in Foreshadow itself.
 */
export function taskCardBlock(task: TaskForUnfurl): SlackTaskCardBlock {
  const { title } = computeCardFields(task);

  // Build the details rich_text. Skip lines whose value is missing so
  // the expanded card stays tight — better to omit a row than render
  // "Scheduled: —" or similar filler.
  const detailSections: SlackRichTextSection[] = [];

  const place = task.property_name?.trim() || task.bin_name?.trim();
  if (place) {
    detailSections.push({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'Property: ', style: { bold: true } },
        { type: 'text', text: place },
      ],
    });
  }

  const scheduled = formatScheduled(task.scheduled_date, task.scheduled_time);
  if (scheduled) {
    detailSections.push({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'Scheduled: ', style: { bold: true } },
        { type: 'text', text: scheduled },
      ],
    });
  }

  const card: SlackTaskCardBlock = {
    type: 'task_card',
    task_id: task.task_id,
    title,
    status: toTaskCardStatus(task.status),
    block_id: `task-card-${task.task_id}`,
    sources: [
      { type: 'url', url: task.task_url, text: 'Open in Foreshadow' },
    ],
  };

  if (detailSections.length > 0) {
    card.details = { type: 'rich_text', elements: detailSections };
  }

  return card;
}

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
 *   own examples never show link syntax in card.title. The "Open in
 *   Foreshadow" action button is the single click target.
 *
 * Why the button has BOTH `url` and `action_id`:
 *   action_id is required for Slack to fire interactivity events on
 *   click (which our `/api/slack/interactivity` ack endpoint handles).
 *   Without action_id, button-click handling would be inconsistent
 *   across Slack clients. The action_id is structured `open_task_<uuid>`
 *   so future server-side handlers (e.g. "Mark complete from card")
 *   can pattern-match on it without needing a separate dispatch table.
 */
export function taskCard(task: TaskForUnfurl): SlackCardElement {
  const { title, subtitle, bodyLine } = computeCardFields(task);

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
      text: bodyLine,
      verbatim: false,
    },
    actions: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Foreshadow', emoji: false },
        url: task.task_url,
        action_id: `open_task_${task.task_id}`,
      },
    ],
  };
}
