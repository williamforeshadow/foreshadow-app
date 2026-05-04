// Stable URL conventions for deep-linking into the app.
//
// Three consumers today:
//   - The agent tools (find_tasks, create_task) attach a `task_url` to every
//     row they return so the model can link into the app from any surface.
//   - The Slack route uses the same shape; markdownToMrkdwn turns the
//     resulting `[title](url)` into Slack's `<url|title>` automatically.
//   - The dedicated `/tasks/[id]` route is the canonical render target —
//     it does an SSR fetch via getTaskById and ships fully populated HTML,
//     which sidesteps the SPA-shell hydration races that the legacy
//     query-param form (`/?view=tasks&task=<uuid>`) was prone to in
//     mobile webviews (Slack iOS in particular).
//
// Why a separate module: the path shape is the contract between the agent's
// tool output, the in-app deep-link handler in
// lib/reservationViewerContext.tsx, and the new /tasks/[id] route. Anyone
// who needs to construct or recognise a Foreshadow task URL goes through
// here, so a future URL change is a single-file edit.

/**
 * Absolute base URL for the app, no trailing slash. Empty string when
 * APP_BASE_URL isn't set — callers that need an absolute URL (Slack) should
 * fall back to omitting the link rather than emitting a broken one.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL ?? '';
  // trim() before the trailing-slash strip: Vercel env-var inputs
  // silently preserve leading/trailing whitespace (newlines, spaces,
  // tabs) when pasted with one. Once whitespace gets into the base
  // URL, any consumer that embeds it in Slack mrkdwn link syntax
  // (`<url|label>`) breaks — Slack's parser rejects URLs with
  // embedded whitespace and falls back to rendering the literal
  // `<url|label>` text. Belt-and-suspenders defence: trim here so a
  // dirty env var can't silently corrupt every downstream link.
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Path (no host) for the canonical task page. Renders via the
 * `app/tasks/[id]/page.tsx` server component — auth-gated by the root
 * layout, full SSR of the task body, no SPA-shell bootstrap required.
 *
 * Backward compatibility: parseTaskUrl below also recognises the legacy
 * `/?view=tasks&task=<uuid>` shape that older Slack messages carry, and
 * TaskDeepLinkSync auto-upgrades that form to this canonical path on
 * navigation. New URLs the agent or Slack emits use this shape directly.
 */
export function taskPath(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}`;
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
 * link-unfurl handler to recognise our URLs in arbitrary messages and by
 * TaskDeepLinkSync to redirect legacy URLs forward.
 *
 * Recognises BOTH shapes:
 *   - Canonical:  /tasks/<uuid>            (the form taskPath() emits today)
 *   - Legacy:     /?view=tasks&task=<uuid> (the form Slack messages from
 *                                            before the /tasks route had —
 *                                            kept readable so old unfurls
 *                                            still find their task and old
 *                                            chats can keep linking)
 *
 * Validation rules (apply to both shapes):
 *   - The input must parse as an absolute URL.
 *   - When APP_BASE_URL is configured, the URL's host must match it. Slack's
 *     unfurl flow already filters by registered domain, but we re-check here
 *     so ad-hoc callers (e.g. scanning the bot's own reply for task links)
 *     can't accidentally unfurl URLs from other domains.
 *   - The extracted id must be a well-formed UUID.
 *
 * Note: for the legacy form we deliberately don't require `view=tasks`.
 * Older copies of the URL (or third-party rewrites) sometimes drop or
 * reorder query params; the `task` UUID is the only piece the deep-link
 * handler actually needs.
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
  // Canonical /tasks/<uuid> — try the path first since that's what new URLs
  // use. Trailing slash tolerated to match real-world copy/paste.
  const pathMatch = url.pathname.match(/^\/tasks\/([^/]+)\/?$/);
  if (pathMatch) {
    const candidate = decodeURIComponent(pathMatch[1]);
    if (UUID_RE.test(candidate)) return { taskId: candidate };
    return null;
  }
  // Legacy /?view=tasks&task=<uuid>.
  const legacyId = url.searchParams.get('task');
  if (legacyId && UUID_RE.test(legacyId)) return { taskId: legacyId };
  return null;
}
