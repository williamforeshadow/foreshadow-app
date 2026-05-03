// Stable URL conventions for deep-linking into the app.
//
// Two consumers today:
//   - The agent tools (find_tasks, create_task) attach a `task_url` to every
//     row they return so the model can link into the app from any surface.
//   - The Slack route uses the same shape; markdownToMrkdwn turns the
//     resulting `[title](url)` into Slack's `<url|title>` automatically.
//
// Why a separate module: the path shape is the contract between the agent's
// tool output and the in-app deep-link handler in
// lib/reservationViewerContext.tsx. Centralising it keeps every renamer in
// one place if we ever change the URL surface (e.g. /tasks/[id] instead of
// query-param-based).

/**
 * Absolute base URL for the app, no trailing slash. Empty string when
 * APP_BASE_URL isn't set — callers that need an absolute URL (Slack) should
 * fall back to omitting the link rather than emitting a broken one.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL ?? '';
  return raw.replace(/\/+$/, '');
}

/**
 * Path (no host) the in-app dashboard recognises as "open this task".
 * `view=tasks` puts the desktop dashboard on the Tasks tab so the overlay
 * lands over the right list; mobile ignores `view` and just opens the
 * overlay over whatever tab is showing. The `?task=` half is what
 * ReservationViewerProvider watches for.
 */
export function taskPath(taskId: string): string {
  return `/?view=tasks&task=${encodeURIComponent(taskId)}`;
}

/**
 * Absolute URL for the same task. Returns the path alone when APP_BASE_URL
 * isn't configured — that still renders correctly in the in-app chat
 * (react-markdown follows relative hrefs) and at worst makes Slack links
 * non-clickable rather than crashing the agent reply.
 */
export function taskUrl(taskId: string): string {
  const base = getAppBaseUrl();
  const path = taskPath(taskId);
  return base ? `${base}${path}` : path;
}
