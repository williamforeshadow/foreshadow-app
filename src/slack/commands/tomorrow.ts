import type { Block } from '@slack/types';
import { buildDailyOutlookBlocks, dailyOutlookText } from '@/src/slack/dailyOutlookBlocks';
import { getDailyOutlookData } from '@/src/server/commands/dailyOutlook';

// Handler for the `/tomorrow` Slack slash command.
//
// Same shape as /dailyoutlook (src/slack/commands/dailyOutlook.ts) but for
// tomorrow: reservation check-outs/ins and the invoking user's assigned tasks
// scheduled for tomorrow. Fully deterministic — no LLM. The data-fetching is
// the shared src/server/commands/dailyOutlook.ts with offsetDays = 1, and the
// rendering reuses the daily-outlook Block Kit builder with "Tomorrow" copy.

export interface TomorrowResult {
  text: string;
  blocks: Block[];
}

export async function runTomorrow(args: {
  appUserId: string;
  displayName: string;
}): Promise<TomorrowResult> {
  const { appUserId, displayName } = args;

  const data = await getDailyOutlookData(appUserId, 1);
  if (!data.ok) {
    return {
      text: `Sorry — I couldn't load tomorrow's outlook right now. Try again in a moment.`,
      blocks: [],
    };
  }

  if (
    data.tasks.length === 0 &&
    data.checkOuts.length === 0 &&
    data.checkIns.length === 0
  ) {
    return {
      text: `${displayName}, nothing scheduled for tomorrow.`,
      blocks: [],
    };
  }

  const blocks = buildDailyOutlookBlocks({
    dateStr: data.date,
    checkOuts: data.checkOuts,
    checkIns: data.checkIns,
    orderedTasks: data.tasks,
    headerLabel: 'Tomorrow',
    dayWord: 'tomorrow',
  });

  const text = dailyOutlookText({
    displayName,
    taskCount: data.tasks.length,
    checkOutCount: data.checkOuts.length,
    checkInCount: data.checkIns.length,
    label: "Tomorrow's Outlook",
    dayWord: 'tomorrow',
  });

  return { text, blocks };
}
