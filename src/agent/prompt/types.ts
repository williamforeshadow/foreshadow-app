// What actually differs between the surfaces the agent answers on.
//
// The system prompt used to be one string with `surface === 'slack'` ternaries
// buried in it, which had two costs. Rules meant for one surface leaked into
// the other (the Slack confirmation-button paragraph was unconditional, so web
// users' prompts carried it), and several lines existed only to explain one
// surface TO the other — "both Slack and the in-app chat render markdown
// links", "never tell the user comments are Slack-only". Every one of those
// was a workaround for a single prompt serving two readers.
//
// Split, each surface states its own truth and core.ts carries what is
// genuinely shared. Keep this interface SMALL: a field here is a claim that
// the two surfaces really do differ. Anything that reads the same on both,
// once you stop naming the other one, belongs in core.

export interface SurfacePrompt {
  /**
   * Where the model is writing and what markup renders there. Lands in the
   * "Current context" block, so it should be one or two `- ` bullets.
   */
  rendering: string;
  /**
   * The strict bare-linked-title rule for enumerated task lists. Both surfaces
   * enforce it; they differ only in which card is already showing the metadata
   * that inline text would duplicate.
   */
  enumeration: string;
  /**
   * How a previewed write gets confirmed here. Lands in the write protocol.
   * Both surfaces put a single Confirm/Cancel pair under the message; they
   * differ in what the model should say about it.
   */
  confirmation: string;
}
