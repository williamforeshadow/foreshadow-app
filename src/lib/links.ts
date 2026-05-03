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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inverse of taskUrl: pulls a task UUID out of a Foreshadow task URL, or
 * returns null if the input doesn't look like one. Used by the Slack
 * link-unfurl handler to recognise our URLs in arbitrary messages.
 *
 * Validation rules:
 *   - The input must parse as an absolute URL.
 *   - When APP_BASE_URL is configured, the URL's host must match it. Slack's
 *     unfurl flow already filters by registered domain, but we re-check here
 *     so ad-hoc callers (e.g. scanning the bot's own reply for task links)
 *     can't accidentally unfurl URLs from other domains.
 *   - The `task` query param must be present and a well-formed UUID.
 *
 * Note: we deliberately don't require `view=tasks`. Older copies of the URL
 * (or third-party rewrites) sometimes drop or reorder query params; the
 * `task` UUID is the only piece the deep-link handler actually needs.
 */
export function parseTaskUrl(input: string): { taskId: string } | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const base = getAppBaseUrl();
  if (base) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(base);
    } catch {
      return null;
    }
    if (url.host !== baseUrl.host) return null;
  }
  const taskId = url.searchParams.get('task');
  if (!taskId || !UUID_RE.test(taskId)) return null;
  return { taskId };
}
