import type { Block } from '@slack/types';
import { buildDailyOutlookBlocks, dailyOutlookText } from '@/src/slack/dailyOutlookBlocks';
import { getDailyOutlookData } from '@/src/server/commands/dailyOutlook';

// Handler for the `/dailyoutlook` Slack slash command.
//
// Shows the invoking user today's reservation check-outs, check-ins, and the
// tasks scheduled for today that they're assigned to. Fully deterministic —
// no LLM. The data-fetching lives in the surface-agnostic
// src/server/commands/dailyOutlook.ts (shared with the in-app chat command);
// this handler is just the Slack rendering shell.

export interface DailyOutlookResult {
  text: string;
  blocks: Block[];
}

export async function runDailyOutlook(args: {
  appUserId: string;
  displayName: string;
}): Promise<DailyOutlookResult> {
  const { appUserId, displayName } = args;

  const data = await getDailyOutlookData(appUserId);
  if (!data.ok) {
    return {
      text: `Sorry — I couldn't load your daily outlook right now. Try again in a moment.`,
      blocks: [],
    };
  }

  if (
    data.tasks.length === 0 &&
    data.checkOuts.length === 0 &&
    data.checkIns.length === 0
  ) {
    return {
      text: `${displayName}, nothing on the board today. Enjoy the quiet.`,
      blocks: [],
    };
  }

  const blocks = buildDailyOutlookBlocks({
    dateStr: data.date,
    checkOuts: data.checkOuts,
    checkIns: data.checkIns,
    orderedTasks: data.tasks,
  });

  const text = dailyOutlookText({
    displayName,
    taskCount: data.tasks.length,
    checkOutCount: data.checkOuts.length,
    checkInCount: data.checkIns.length,
  });

  return { text, blocks };
}
