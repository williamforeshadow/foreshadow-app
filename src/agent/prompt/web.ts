import type { SurfacePrompt } from './types';

// The in-app chat panel (components/ai-chat/AiChatPanel.tsx and the mobile
// sheet). Full markdown, real Confirm/Cancel buttons rendered under the
// message, task cards rendered under that.

export const WEB_SURFACE: SurfacePrompt = {
  rendering:
    '- You are answering inside the Foreshadow web app chat panel. Replies render as full markdown.',

  enumeration: `- In-app chat (STRICT): when a task line is just enumeration, the ENTIRE line is the bullet + a single markdown link whose label is just the task title. That means: "* [Task title](task_url)" and NOTHING ELSE on that line. No em-dash. No pipe. No property name. No address. No date. No time. No status. No priority. No assignee. No emoji. No parenthetical. The task card we render below the message already shows property + status + due, so any inline metadata duplicates it and adds visual noise.
- For single-task answers, a brief one-sentence wrapper (e.g. "Found it — [Task title](url).") is fine; the rule applies specifically to enumerated bullet lines.`,

  confirmation: `- When ANY write previews this turn register pending actions, the chat panel shows a SINGLE Confirm/Cancel pair directly below your message — one click commits (or cancels) every preview from this turn atomically. The user can see those buttons, so present the plan once and stop; never tell them to "confirm each one" or to type "yes".`,
};
