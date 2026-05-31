import type { AssignmentTask, MyAssignmentsData } from './myAssignments';
import type { DailyOutlookData, ReservationSummary } from './dailyOutlook';

// Markdown renderers for the in-app chat slash commands. The data comes from
// the shared command data layer; these produce plain markdown that the chat
// panel renders with ReactMarkdown (same as any agent reply). The Slack
// surface has its own Block Kit renderers — this is the web equivalent.

function taskLine(at: AssignmentTask): string {
  const t = at.task;
  const title = t.title?.trim() || t.template_name?.trim() || 'Untitled task';
  const meta: string[] = [t.property_name];
  if (t.scheduled_date) {
    meta.push(
      t.scheduled_time
        ? `${t.scheduled_date} ${t.scheduled_time}`
        : t.scheduled_date,
    );
  }
  return `* [${title}](${at.url}) — ${meta.join(' · ')}`;
}

export function renderMyAssignmentsMarkdown(
  data: MyAssignmentsData,
  displayName: string,
): string {
  if (!data.ok) {
    return "Sorry — I couldn't load your assignments right now. Try again in a moment.";
  }
  if (data.tasks.length === 0) {
    return `${displayName}, you have no open assignments. Nice.`;
  }
  const noun = data.tasks.length === 1 ? 'assignment' : 'assignments';
  return [
    `**Your open ${noun} (${data.tasks.length})**`,
    '',
    ...data.tasks.map(taskLine),
  ].join('\n');
}

function reservationLines(label: string, rows: ReservationSummary[]): string[] {
  if (rows.length === 0) return [];
  return [
    `**${label} (${rows.length})**`,
    ...rows.map(
      (r) => `* ${r.property_name} — ${r.guest_name?.trim() || 'No guest name'}`,
    ),
    '',
  ];
}

// Per-command copy for the daily-outlook family. Defaults render the
// `/dailyoutlook` (today) wording byte-for-byte unchanged; /tomorrow passes
// its own variant. `headerLabel` precedes "— <date>"; `dayWord` fills "Your
// tasks <dayWord>"; `emptyBody` is the sentence after "<name>, ".
export interface OutlookCopy {
  headerLabel: string;
  dayWord: string;
  emptyBody: string;
}

export const TODAY_OUTLOOK_COPY: OutlookCopy = {
  headerLabel: 'Daily outlook',
  dayWord: 'today',
  emptyBody: 'nothing on the board today. Enjoy the quiet.',
};

export const TOMORROW_OUTLOOK_COPY: OutlookCopy = {
  headerLabel: 'Tomorrow',
  dayWord: 'tomorrow',
  emptyBody: 'nothing scheduled for tomorrow.',
};

export function renderDailyOutlookMarkdown(
  data: DailyOutlookData,
  displayName: string,
  copy: OutlookCopy = TODAY_OUTLOOK_COPY,
): string {
  if (!data.ok) {
    return "Sorry — I couldn't load your daily outlook right now. Try again in a moment.";
  }
  if (
    data.tasks.length === 0 &&
    data.checkOuts.length === 0 &&
    data.checkIns.length === 0
  ) {
    return `${displayName}, ${copy.emptyBody}`;
  }

  const lines: string[] = [`**${copy.headerLabel} — ${data.date}**`, ''];
  lines.push(...reservationLines('Check-ins', data.checkIns));
  lines.push(...reservationLines('Check-outs', data.checkOuts));
  if (data.tasks.length > 0) {
    const noun = data.tasks.length === 1 ? 'task' : 'tasks';
    lines.push(`**Your ${noun} ${copy.dayWord} (${data.tasks.length})**`);
    lines.push(...data.tasks.map(taskLine));
  }
  return lines.join('\n').trim();
}
