import type { SessionSummary } from './useAgentChat';

// Date buckets for the chats screen, shared by the docked panel and the mobile
// sheet so the two can't grow separate opinions about what "last week" means.
// The ladder mirrors the message thread's day separators
// (components/messages/ConversationThread.tsx) — Today, Yesterday, then a
// coarser bucket — because a list of chats is read the same way: you remember
// roughly when, not exactly when.

export type SessionGroup = {
  key: string;
  label: string;
  sessions: SessionSummary[];
};

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * A chat's place in time. `last_message_at` is null until a chat has said
 * anything, so fall back to when it was created — otherwise a brand new chat
 * has no bucket to land in and drops out of the list entirely.
 */
function sessionDate(s: SessionSummary): Date | null {
  const iso = s.last_message_at ?? s.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function bucket(d: Date, now: Date): { key: string; label: string } {
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return { key: 'today', label: 'Today' };
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (days < 7) return { key: 'week', label: 'Previous 7 days' };
  // Month and year both, always. relativeTime() drops the year on old dates,
  // so the group header is the only thing telling you which August this was.
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  };
}

/**
 * Bucket sessions by age, newest group first.
 *
 * Assumes the input is already newest-first (listWebSessions orders by
 * last_message_at DESC NULLS LAST), so one sequential pass builds the groups
 * and nothing needs re-sorting. Filter before calling: empty buckets are never
 * emitted, so a search that matches one month renders one header.
 */
export function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const now = new Date();
  const groups: SessionGroup[] = [];
  for (const s of sessions) {
    const d = sessionDate(s);
    const { key, label } = d
      ? bucket(d, now)
      : { key: 'undated', label: 'Undated' };
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sessions.push(s);
    else groups.push({ key, label, sessions: [s] });
  }
  return groups;
}
