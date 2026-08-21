import { todayInTz } from '@/src/lib/dates';
import { buildWebPrompt } from './web';
import { buildSlackPrompt } from './slack';

// The system prompt entry point.
//
// Each surface owns its full prompt: web.ts and slack.ts compose theirs from
// the shared blocks in blocks.ts plus their own text. Edit the web prompt in
// web.ts (or by moving a block out of blocks.ts), and Slack's output is
// untouched — that independence is the point of the split. This module only
// resolves the dynamic context (date/tz, actor) and dispatches.

/**
 * Where this agent run originates. Picks which surface module composes the
 * prompt; tool dispatch is surface-aware too (see tools/index.ts).
 */
export type AgentSurface = 'web' | 'slack';

/**
 * The Foreshadow user the agent is talking to right now.
 *
 * Resolved before the run by the caller — Slack does slack user → email →
 * users row; web takes the verified Supabase session (requireAuthContext).
 * The system prompt grounds "me" / "my" / "I" to this user_id so the model
 * doesn't have to round-trip through find_users on every self-referencing
 * message (which is both slower and ambiguous when names collide — two
 * "Billy"s in the same table is a real possibility).
 */
export interface AgentActor {
  /** Foreshadow users.id UUID. */
  appUserId: string;
  /** Display name. Used in the prompt for natural-sounding grounding. */
  name: string;
  /** Permission tier; informs the model about what writes are appropriate. */
  role: 'superadmin' | 'manager' | 'staff' | 'vendor';
}

/** Exported so the prompt can be rendered and inspected without a live run. */
export function buildSystemPrompt(
  clientTz: string | undefined,
  surface: AgentSurface,
  actor: AgentActor | undefined,
): string {
  const { date, tz } = todayInTz(clientTz);
  return surface === 'slack'
    ? buildSlackPrompt(date, tz, actor)
    : buildWebPrompt(date, tz, actor);
}
