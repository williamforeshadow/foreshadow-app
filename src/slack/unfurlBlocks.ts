import type { KnownBlock } from '@slack/types';

// Block Kit builder for task unfurls.
//
// Renders a single task as a card that Slack will inline beneath any message
// containing the task URL. Layout is loosely modelled on Linear's issue
// unfurl: bold linked title, context line for property/department, optional
// description preview, then a 2-column field grid (Status / Assignee /
// Due / Priority), then an explicit "Open in Foreshadow" button.
//
// Why mrkdwn (not plain markdown): Block Kit text objects with type='mrkdwn'
// follow Slack's own formatting flavour — single-asterisk bold, <url|text>
// links — which is the same flavour markdownToMrkdwn already produces for
// the bot's reply text. Keeping both surfaces in mrkdwn means we don't have
// to maintain two link-rendering paths.

export interface TaskForUnfurl {
  task_id: string;
  /** Task title; may be empty for templated tasks that haven't been edited. */
  title: string | null;
  /** Falls back into the card title slot when `title` is missing. */
  template_name: string | null;
  /** Free-text task description. Truncated for the card. */
  description: string | null;
  /** Status enum value from turnover_tasks (e.g. 'in_progress'). */
  status: string;
  /** Priority enum value (e.g. 'high'). */
  priority: string;
  /** Property the task is associated with — appears in the context line. */
  property_name: string | null;
  /** Department label — appears in the context line alongside property. */
  department_name: string | null;
  /** Bin the task lives in. Only shown when there's no property. */
  bin_name: string | null;
  /** YYYY-MM-DD wall-clock date; null when unscheduled. */
  scheduled_date: string | null;
  /** HH:MM[:SS] wall-clock time; null when no specific time set. */
  scheduled_time: string | null;
  /** Assignees (just user ids and display names — no avatars in v1). */
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

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
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

function formatPriority(p: string): string {
  return PRIORITY_LABELS[p] ?? p;
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

// Single-assignee → "Name". Multi → "Name + N". Zero → "Unassigned".
// Avatars are intentionally omitted for v1 (Block Kit's `fields` array
// doesn't render images, and switching to per-assignee context blocks would
// blow up the card height for tasks with several assignees).
function formatAssignee(users: TaskForUnfurl['assigned_users']): string {
  if (users.length === 0) return 'Unassigned';
  const first = users[0]?.name?.trim() || 'Unknown';
  if (users.length === 1) return first;
  return `${first} + ${users.length - 1}`;
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

// Slack mrkdwn treats `&`, `<`, and `>` as control characters. Anything that
// goes into a TextObject must be HTML-entity-escaped or it can break the
// rendering — e.g. a property name containing "&" would otherwise be
// reinterpreted as the start of an entity.
function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the Block Kit blocks for a task unfurl. The caller wraps the result
 * in `{ blocks }` and slots it into a `chat.unfurl` `unfurls` map keyed by
 * URL — which is what Slack expects.
 */
export function taskUnfurl(task: TaskForUnfurl): { blocks: KnownBlock[] } {
  const titleText = (task.title?.trim() || task.template_name?.trim() || 'Untitled task');

  // Subtitle context: property · department, falling back to bin if no
  // property. Empty strings get filtered out so we don't render trailing
  // separators.
  const subtitleParts: string[] = [];
  if (task.property_name) subtitleParts.push(task.property_name);
  else if (task.bin_name) subtitleParts.push(task.bin_name);
  if (task.department_name) subtitleParts.push(task.department_name);
  const subtitle = subtitleParts.join(' · ');

  const blocks: KnownBlock[] = [];

  // Title row: bold + linked, mrkdwn `*<url|text>*` renders as bold link.
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*<${task.task_url}|${escapeMrkdwn(titleText)}>*`,
    },
  });

  if (subtitle) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: escapeMrkdwn(subtitle),
        },
      ],
    });
  }

  if (task.description?.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: escapeMrkdwn(truncate(task.description, 240)),
      },
    });
  }

  // Field grid. Slack renders `fields` as a 2-column layout, top-aligned,
  // wrapping vertically when there are more than two. Each field is
  // `*Label*\nValue` so the label renders bold above the value — matching
  // the Linear screenshot.
  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    {
      type: 'mrkdwn',
      text: `*Status*\n${escapeMrkdwn(formatStatus(task.status))}`,
    },
    {
      type: 'mrkdwn',
      text: `*Assignee*\n${escapeMrkdwn(formatAssignee(task.assigned_users))}`,
    },
  ];

  const due = formatScheduled(task.scheduled_date, task.scheduled_time);
  if (due) {
    fields.push({ type: 'mrkdwn', text: `*Due*\n${escapeMrkdwn(due)}` });
  }
  if (task.priority) {
    fields.push({
      type: 'mrkdwn',
      text: `*Priority*\n${escapeMrkdwn(formatPriority(task.priority))}`,
    });
  }

  blocks.push({ type: 'section', fields });

  // Explicit action button. The title is already a link, but a discrete
  // button is more obviously clickable on mobile and matches the affordance
  // of other app unfurls in Slack (Linear, GitHub, Notion).
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
