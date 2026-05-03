import type { WebClient } from '@slack/web-api';
import { parseTaskUrl } from '@/src/lib/links';
import {
  getTasksByIds,
  type TaskByIdRow,
} from '@/src/server/tasks/getTaskById';
import { taskUnfurl, type TaskForUnfurl } from './unfurlBlocks';

// Slack link-unfurl orchestrator.
//
// Two entry points feed this module:
//
//   1. `link_shared` events from app/api/slack/events/route.ts — fired
//      whenever a message in a channel the bot is in (or a DM) contains a
//      URL on a domain we registered in our Slack app config. The event
//      hands us a list of `{ url, domain }` and the (channel, message_ts)
//      they appeared in.
//
//   2. The bot's own replies — Slack does NOT fire `link_shared` for
//      messages posted by the same bot, so handleSlackMessage scans its
//      reply text after chat.postMessage returns and calls back into here
//      to manually unfurl any task URLs it just emitted.
//
// In both cases the algorithm is identical:
//   - Filter URLs through parseTaskUrl to recognise our task links.
//   - Fetch all matched tasks in one round-trip via getTasksByIds.
//   - Build a Block Kit card per URL via taskUnfurl.
//   - Submit them as the `unfurls` map on chat.unfurl.
//
// Anything we don't recognise — non-task URLs, bogus UUIDs, deleted tasks —
// gets silently dropped from the unfurls map. Slack treats a missing entry
// as "no preview", which is the right UX for the unrecognised case.

/** Subset of the link_shared event link shape we actually care about. */
export interface SlackLink {
  url: string;
  domain?: string;
}

/**
 * Unfurl every task URL in `links` that we can resolve, attaching the
 * resulting cards to the message at (channel, ts).
 *
 * Best-effort: errors from chat.unfurl are logged but never thrown. The
 * caller can fire-and-forget without try/catch.
 */
export async function unfurlTaskLinks(
  web: WebClient,
  channel: string,
  ts: string,
  links: SlackLink[],
): Promise<void> {
  const recognised = recogniseLinks(links);
  if (recognised.length === 0) return;

  const taskIds = Array.from(new Set(recognised.map((r) => r.taskId)));
  const tasks = await getTasksByIds(taskIds);
  const byId = new Map(tasks.map((t) => [t.task_id, t]));

  // Build the unfurls map. Slack expects URLs as keys and `{ blocks }` (or
  // `{ text }`) as values. URLs whose task wasn't found get skipped — Slack
  // falls back to no preview for those, which is the right behaviour for
  // deleted/unknown ids.
  const unfurls: Record<string, { blocks: ReturnType<typeof taskUnfurl>['blocks'] }> = {};
  for (const { url, taskId } of recognised) {
    const t = byId.get(taskId);
    if (!t) continue;
    unfurls[url] = taskUnfurl(toUnfurlShape(t, url));
  }
  if (Object.keys(unfurls).length === 0) return;

  try {
    // chat.unfurl accepts the unfurls map as JSON in the SDK. The type for
    // `unfurls` here is a Record<url, MessageAttachment | LinkUnfurls>; our
    // `{ blocks }` shape is the modern equivalent. The SDK accepts it but
    // its compile-time typing predates blocks-on-unfurl, so cast.
    await web.chat.unfurl({
      channel,
      ts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unfurls: unfurls as any,
    });
  } catch (err) {
    console.error('[slack] chat.unfurl failed', {
      channel,
      ts,
      url_count: Object.keys(unfurls).length,
      err,
    });
  }
}

/**
 * Pull URLs that match parseTaskUrl out of arbitrary message text.
 *
 * Used by handleSlackMessage to drive the manual-unfurl path described
 * above (Slack won't fire link_shared for our own bot's posts). The regex
 * deliberately stops at `|` and `>` so it works on both raw URLs and
 * Slack's mrkdwn `<url|label>` link form.
 */
export function extractTaskUrlsFromText(text: string): string[] {
  if (!text) return [];
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s|>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (parseTaskUrl(m[0])) urls.add(m[0]);
  }
  return Array.from(urls);
}

interface RecognisedLink {
  url: string;
  taskId: string;
}

function recogniseLinks(links: SlackLink[]): RecognisedLink[] {
  const out: RecognisedLink[] = [];
  for (const link of links) {
    const parsed = parseTaskUrl(link.url);
    if (parsed) out.push({ url: link.url, taskId: parsed.taskId });
  }
  return out;
}

// Map the wider TaskByIdRow (which carries reservation/comment/etc fields
// the unfurl card doesn't need) onto the slimmer TaskForUnfurl shape. We
// pass the URL through as-is rather than rebuilding it from APP_BASE_URL,
// so deep-links round-trip identically even if the env var changes between
// when the message was posted and when it gets unfurled.
//
// `description` arrives as ProseMirror/TipTap JSON (the rich-text editor
// format the in-app overlay uses), not a string — flatten it here so the
// downstream block builder can stick to its plain-text contract.
function toUnfurlShape(t: TaskByIdRow, url: string): TaskForUnfurl {
  const descriptionText = proseMirrorToPlainText(t.description).trim();
  return {
    task_id: t.task_id,
    title: t.title,
    template_name: t.template_name,
    description: descriptionText || null,
    status: t.status,
    priority: t.priority,
    property_name: t.property_name,
    department_name: t.department_name,
    bin_name: t.bin_name,
    scheduled_date: t.scheduled_date,
    scheduled_time: t.scheduled_time,
    assigned_users: t.assigned_users.map((u) => ({
      user_id: u.user_id,
      name: u.name,
    })),
    task_url: url,
  };
}

interface ProseMirrorNode {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
}

// Walk a ProseMirror/TipTap doc and concatenate the text leaves. Block-ish
// node types (paragraphs, list items, headings, etc.) get a newline after
// their content so the result stays readable when truncated for the unfurl
// card; inline marks just contribute their text.
//
// Pure plain text — no bold/italic/list markers. Slack mrkdwn could carry
// some of those, but mapping ProseMirror's nested marks onto mrkdwn is
// fiddly and the truncated 240-char preview rarely benefits from it.
//
// Tolerant on input shape: anything that isn't an object or string returns
// "" so callers can pass `unknown` from getTaskById without pre-checking.
const PM_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list_item',
  'listItem',
  'bullet_list',
  'bulletList',
  'ordered_list',
  'orderedList',
  'task_item',
  'taskItem',
  'task_list',
  'taskList',
  'code_block',
  'codeBlock',
  'horizontal_rule',
  'horizontalRule',
]);

function proseMirrorToPlainText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const n = node as ProseMirrorNode;
  if (typeof n.text === 'string') return n.text;
  const children = Array.isArray(n.content)
    ? n.content.map(proseMirrorToPlainText).join('')
    : '';
  if (n.type && PM_BLOCK_TYPES.has(n.type)) {
    return children ? `${children}\n` : '';
  }
  return children;
}
