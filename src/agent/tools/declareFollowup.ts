import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

// declare_followup — the agent's way of saying "there is a dependent second
// step after this commit", so the Confirm button can actually deliver it.
//
// Confirming used to end the turn: the routes committed the previewed writes,
// posted a summary, and stopped. Anything the agent still needed to do — the
// classic case being work that needs ids the commit is about to create — had to
// wait for the operator to send another message. The agent had no honest way to
// promise a next step, so the system prompt banned it from trying.
//
// This tool converts that ban into a mechanism. Call it in the SAME turn as the
// previews; the instruction is stored alongside the pending actions and replayed
// as a fresh agent turn once EVERY action in the bundle commits successfully.
// It writes nothing itself and does not extend what the agent may do — the
// replayed turn goes through the ordinary preview/confirm protocol like any
// other.

const inputSchema = z.object({
  instruction: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'Plain-English description of the remaining step, written to your future self as an instruction.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface DeclareFollowupData {
  instruction: string;
  /** False when the surface has no confirm step to continue from. */
  registered: boolean;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<DeclareFollowupData>> {
  if (!ctx.followup) {
    // No confirm step on this surface, so nothing would ever replay it. Say so
    // plainly rather than accepting silently — a false "registered" would let
    // the model promise a continuation that can never happen, which is the
    // exact failure this tool exists to remove.
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'This surface has no confirmation step, so a follow-up cannot be scheduled. Do the work in this turn or tell the user what remains.',
      },
    };
  }
  ctx.followup.instruction = input.instruction;
  return {
    ok: true,
    data: { instruction: input.instruction, registered: true },
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const declareFollowup: ToolDefinition<Input, DeclareFollowupData> = {
  name: 'declare_followup',
  description:
    "Register work that must happen AFTER the user confirms this turn's previews, because it depends on ids the commit will create. Call it in the SAME turn as your preview tools. Once every action in the bundle commits, your instruction runs as a fresh turn automatically — so the user gets the whole job from one Confirm instead of having to message you again. Use it ONLY for genuine ordering dependencies (e.g. 'comment on the tasks that were just created', 'attach the uploaded photo to the room this batch created'). Do NOT use it for work you could have previewed in the same turn: writes that merely target several things at once already commit together under one Confirm, and batch tools exist for multi-property and multi-task cases — reach for those first. Do NOT use it to split a job you are unsure about; ask the user instead. If the commit partially fails, the follow-up is skipped and the user is told, since the ids it depends on may not exist. Write the instruction to your future self, naming what to look up rather than guessing ids you do not have yet.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      instruction: {
        type: 'string',
        description:
          "What to do after the commit, in plain English, addressed to your future self. It will arrive as a new turn with the commit results attached, so refer to things by name/description rather than by ids you don't have yet — e.g. \"add a comment to the three tasks just created at 120 Island saying the vendor is booked for Tuesday\".",
      },
    },
    required: ['instruction'],
    additionalProperties: false,
  },
  handler,
};
