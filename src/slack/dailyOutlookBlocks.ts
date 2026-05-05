import type { Block, KnownBlock } from '@slack/types';
import type { TaskByIdRow } from '@/src/server/tasks/getTaskById';
import { assignmentsUrl } from '@/src/lib/links';
import { OPEN_BUTTON_LABEL, type SlackCardElement } from './unfurlBlocks';

// Block Kit builder for the /dailyoutlook slash-command response.
//
// Same ephemeral delivery as /myassignments (chat.postEphemeral), so the
// same card-based layout works here. Visual structure:
//
//   header (level: 1)       — "Daily Outlook — Monday, May 5, 2026"
//   context-link            — link to My Assignments page
//   section                 — reservation summary (check-outs + check-ins)
//   divider
//   task cards / bullet list — today's assigned tasks
//
// When there are no tasks AND no reservations, the caller returns a
// plain-text "nothing today" message instead of calling this builder.

const MAX_OUTLOOK_CARDS = 10;
const NO_PROPERTY_LABEL = 'No property';
const PAGE_LINK_LABEL = `Open My Assignments ${OPEN_BUTTON_LABEL}`;

function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateForHeader(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function outlookHeaderBlock(dateStr: string): Block {
  const formatted = formatDateForHeader(dateStr);
  return {
    type: 'header',
    text: { type: 'plain_text', text: `Daily Outlook \u2014 ${formatted}`, emoji: true },
    level: 1,
  } as unknown as Block;
}

function pageLinkContextBlock(): KnownBlock | null {
  const url = assignmentsUrl();
  if (!url) return null;
  return {
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `<${url}|${PAGE_LINK_LABEL}>` },
    ],
  };
}

// ── Reservations ────────────────────────────────────────────────────────

export interface ReservationSummary {
  property_name: string;
  guest_name: string | null;
}

function reservationsSectionBlock(args: {
  checkOuts: ReservationSummary[];
  checkIns: ReservationSummary[];
}): KnownBlock | null {
  const { checkOuts, checkIns } = args;
  if (checkOuts.length === 0 && checkIns.length === 0) return null;

  const lines: string[] = [];

  if (checkOuts.length > 0) {
    lines.push(`*Check-outs (${checkOuts.length})*`);
    for (const r of checkOuts) {
      const guest = r.guest_name ? escapeMrkdwn(r.guest_name) : 'No guest name';
      lines.push(`\u2022 ${escapeMrkdwn(r.property_name)} \u2014 ${guest}`);
    }
  }

  if (checkIns.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`*Check-ins (${checkIns.length})*`);
    for (const r of checkIns) {
      const guest = r.guest_name ? escapeMrkdwn(r.guest_name) : 'No guest name';
      lines.push(`\u2022 ${escapeMrkdwn(r.property_name)} \u2014 ${guest}`);
    }
  }

  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
  };
}

// ── Tasks ───────────────────────────────────────────────────────────────

function taskCardBlock(task: TaskByIdRow, url: string): SlackCardElement {
  const title =
    task.title?.trim() || task.template_name?.trim() || 'Untitled task';
  const place =
    task.property_name?.trim() || task.bin_name?.trim() || NO_PROPERTY_LABEL;

  const subtitleParts = [place];
  if (task.scheduled_time) {
    subtitleParts.push(task.scheduled_time);
  }

  return {
    type: 'card',
    block_id: `outlook-${task.task_id}`,
    title: {
      type: 'mrkdwn',
      text: `*${escapeMrkdwn(title)}*`,
      verbatim: false,
    },
    subtitle: {
      type: 'mrkdwn',
      text: escapeMrkdwn(subtitleParts.join(' \u00b7 ')),
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

function taskBulletBlock(
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

function tasksSectionHeader(count: number): KnownBlock {
  const noun = count === 1 ? 'task' : 'tasks';
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Your tasks today (${count} ${noun})*`,
    },
  };
}

// ── Composer ────────────────────────────────────────────────────────────

export function buildDailyOutlookBlocks(args: {
  dateStr: string;
  checkOuts: ReservationSummary[];
  checkIns: ReservationSummary[];
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>;
}): Block[] {
  const { dateStr, checkOuts, checkIns, orderedTasks } = args;

  const blocks: Block[] = [outlookHeaderBlock(dateStr)];

  const link = pageLinkContextBlock();
  if (link) blocks.push(link as unknown as Block);

  // Reservations section.
  const resSec = reservationsSectionBlock({ checkOuts, checkIns });
  if (resSec) {
    blocks.push(resSec as unknown as Block);
  }

  // Tasks section.
  if (orderedTasks.length > 0) {
    if (resSec) {
      blocks.push({ type: 'divider' } as unknown as Block);
    }

    blocks.push(tasksSectionHeader(orderedTasks.length) as unknown as Block);

    if (orderedTasks.length <= MAX_OUTLOOK_CARDS) {
      for (const row of orderedTasks) {
        blocks.push(taskCardBlock(row.task, row.url) as unknown as Block);
      }
    } else {
      blocks.push(taskBulletBlock(orderedTasks) as unknown as Block);
    }
  }

  return blocks;
}

export function dailyOutlookText(args: {
  displayName: string;
  taskCount: number;
  checkOutCount: number;
  checkInCount: number;
}): string {
  const parts: string[] = [`Daily Outlook for ${args.displayName}:`];

  if (args.checkOutCount > 0 || args.checkInCount > 0) {
    const resParts: string[] = [];
    if (args.checkOutCount > 0) resParts.push(`${args.checkOutCount} check-out${args.checkOutCount !== 1 ? 's' : ''}`);
    if (args.checkInCount > 0) resParts.push(`${args.checkInCount} check-in${args.checkInCount !== 1 ? 's' : ''}`);
    parts.push(resParts.join(', '));
  }

  if (args.taskCount > 0) {
    parts.push(`${args.taskCount} task${args.taskCount !== 1 ? 's' : ''} scheduled`);
  }

  if (args.taskCount === 0 && args.checkOutCount === 0 && args.checkInCount === 0) {
    parts.push('Nothing on the board today.');
  }

  return parts.join(' \u2014 ');
}
