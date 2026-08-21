import type { SurfacePrompt } from './types';
import type { AgentActor } from './core';
import {
  OPENING,
  currentContext,
  HOW_TO_BE_USEFUL,
  LINKING_TASKS,
  LIST_FORMATTING_RULE,
  WRITE_PREVIEW_FORMAT,
  READ_TOOLS_INTRO,
  FINDING_TASKS,
  AVAILABILITY,
  CAPABILITY_QUESTIONS,
  GUEST_MESSAGING,
  GROUNDING,
  RESULT_ENVELOPE,
  IDENTIFIER_RULES,
  OPTION_LISTING,
  writeProtocol,
  CLOSING,
  OPERATIONAL_INSTINCTS,
} from './blocks';

// Slack — @-mentions in channel threads and DMs with the bot. Slack mrkdwn is
// not markdown: no headings, single-asterisk bold, and "- " renders as a
// literal dash rather than a bullet. Block Kit carries the cards and the
// Confirm/Cancel pair.
//
// This file OWNS the Slack prompt: buildSlackPrompt composes it from the
// shared blocks plus the Slack-specific text below. The web prompt evolving
// (proposal cards, formatting cuts) never changes what this file produces —
// Slack stays on the preview/commit protocol until it gets its own pass.

export const SLACK_SURFACE: SurfacePrompt = {
  rendering: `- You are answering inside Slack. Keep replies short, plain text. Use bold sparingly with single-asterisk syntax (*bold*). Do not use markdown headings (#, ##) — Slack does not render them.
- Slack renders "* " as a real bullet glyph but renders "- " literally as a dash, so "* " is the only bullet marker that looks right here.`,

  enumeration: `- Slack-specific (STRICT): when a task line is just enumeration (e.g. "here are the tasks assigned to Rae"), the ENTIRE line is the bullet + a single markdown link whose label is just the task title. That means: "* [Task title](task_url)" and NOTHING ELSE on that line. No em-dash. No pipe. No property name. No address. No date. No time. No status. No priority. No assignee. No emoji. No parenthetical. The Block Kit card we attach below the message already shows property + status + due, so any inline metadata duplicates it and adds visual noise.
- For single-task answers, a brief one-sentence wrapper (e.g. "Found it — [Task title](url).") is fine; the rule applies specifically to enumerated bullet lines.`,

  confirmation: `- Every write preview registers a pending action unless it is a no-op, and the message carries a SINGLE Confirm/Cancel pair — one click commits (or cancels) every preview from this turn atomically. The user can see those buttons, so do not announce them. Never tell the user to type "yes", "go", or to hand you internal ids — the buttons are the confirmation path.`,

  taskCreation: `- Single NEW task: preview_task → create_task.
- Multiple NEW tasks at once (and optionally a brand-new sub-bin in the same operation): preview_tasks_batch → create_tasks_batch. Use the batch pair whenever the user asks for more than one task in one breath.`,
};

/** The full Slack system prompt. */
export function buildSlackPrompt(
  date: string,
  tz: string,
  actor: AgentActor | undefined,
): string {
  return [
    `${OPENING}\n${SLACK_SURFACE.rendering}`,
    currentContext(date, tz, actor),
    HOW_TO_BE_USEFUL,
    LINKING_TASKS,
    `${LIST_FORMATTING_RULE}\n${SLACK_SURFACE.enumeration}`,
    WRITE_PREVIEW_FORMAT,
    READ_TOOLS_INTRO,
    FINDING_TASKS,
    AVAILABILITY,
    CAPABILITY_QUESTIONS,
    GUEST_MESSAGING,
    GROUNDING,
    RESULT_ENVELOPE,
    IDENTIFIER_RULES,
    OPTION_LISTING,
    writeProtocol({
      taskCreation: SLACK_SURFACE.taskCreation,
      confirmation: SLACK_SURFACE.confirmation,
    }),
    CLOSING,
    OPERATIONAL_INSTINCTS,
  ].join('\n\n');
}
