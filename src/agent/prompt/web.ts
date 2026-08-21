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

// The in-app chat panel (components/ai-chat/AiChatPanel.tsx and the mobile
// sheet). Full markdown, real Confirm/Cancel buttons rendered under the
// message, task cards rendered under that.
//
// This file OWNS the web prompt: buildWebPrompt composes it from the shared
// blocks plus the web-specific text below. Reordering, cutting, or adding
// web-only sections happens here and never touches Slack's prompt.

export const WEB_SURFACE: SurfacePrompt = {
  rendering:
    '- You are answering inside the Foreshadow web app chat panel. Replies render as full markdown.',

  enumeration: `- In-app chat (STRICT): when a task line is just enumeration, the ENTIRE line is the bullet + a single markdown link whose label is just the task title. That means: "* [Task title](task_url)" and NOTHING ELSE on that line. No em-dash. No pipe. No property name. No address. No date. No time. No status. No priority. No assignee. No emoji. No parenthetical. The task card we render below the message already shows property + status + due, so any inline metadata duplicates it and adds visual noise.
- For single-task answers, a brief one-sentence wrapper (e.g. "Found it — [Task title](url).") is fine; the rule applies specifically to enumerated bullet lines.`,

  confirmation: `- When ANY write previews this turn register pending actions, the chat panel shows a SINGLE Confirm/Cancel pair directly below your message — one click commits (or cancels) every preview from this turn atomically. The user can see those buttons, so present the plan once and stop; never tell them to "confirm each one" or to type "yes".`,

  taskCreation: `- Creating NEW tasks does NOT use the preview/commit protocol here. Call propose_task instead — it stores a durable proposal that renders as a task card directly below your reply, with its own Create/Dismiss controls and an editor the user can open to adjust fields before creating. Nothing is written until they decide, and the proposal never expires.
- For several new tasks in one request, call propose_task once per task in the same turn; each renders its own card. To also create a new sub-bin for them, use preview_bin → create_bin (that pair still previews) and propose the tasks into it after the bin commits.
- After proposing, your reply is a short caption above the card(s) — say what you proposed and why in a sentence, without restating fields the card already shows, without mentioning buttons, and without claiming the task exists. If the user asks for a change to an undecided proposal, call propose_task again with the corrected fields and replaces_proposal_id.`,
};

/** The full web system prompt. */
export function buildWebPrompt(
  date: string,
  tz: string,
  actor: AgentActor | undefined,
): string {
  return [
    `${OPENING}\n${WEB_SURFACE.rendering}`,
    currentContext(date, tz, actor),
    HOW_TO_BE_USEFUL,
    LINKING_TASKS,
    `${LIST_FORMATTING_RULE}\n${WEB_SURFACE.enumeration}`,
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
      taskCreation: WEB_SURFACE.taskCreation,
      confirmation: WEB_SURFACE.confirmation,
    }),
    CLOSING,
    OPERATIONAL_INSTINCTS,
  ].join('\n\n');
}
