import type { WebClient } from '@slack/web-api';
import type { Block, MessageAttachment } from '@slack/types';
import { parseTaskUrl } from '@/src/lib/links';
import {
  getTasksByIds,
  type TaskByIdRow,
} from '@/src/server/tasks/getTaskById';
import {
  taskCard,
  taskUnfurl,
  type SlackCarouselBlock,
  type TaskForUnfurl,
} from './unfurlBlocks';

// Slack task-card rendering — two surfaces, two layout shapes.
//
// Surface 1: link_shared event (someone pasted a task URL into a channel
//            we're in, or into a DM). Slack fires `link_shared` with a
//            list of URLs and an `unfurl_id` + `source` pair. We respond
//            with chat.unfurl using THOSE identifiers (not channel/ts) —
//            that's the form Slack actually honours across composer-
//            preview, post-send, and conversations_history surfaces. The
//            legacy channel+ts form silently no-ops in many contexts.
//            Layout: one `taskUnfurl` block-list per URL.
//
// Surface 2: bot replies (handleSlackMessage in the events route). Slack
//            does NOT fire `link_shared` for messages posted by our own
//            bot when `unfurl_links: false` is set on chat.postMessage,
//            so we can't piggy-back on the link_shared flow. Instead we
//            attach the task cards directly to the postMessage payload.
//            Layout depends on count:
//              - 1–10 tasks: a horizontal `carousel` block of `taskCard`
//                elements (compact, scrollable).
//              - >10 tasks: vertical `attachments` of `taskUnfurl` blocks
//                (Slack caps carousels at 10 elements).
//
// Both layouts share `getTasksByIds` for data and the slim card fields
// (title / property / status+due / Open in Foreshadow), so cards look
// consistent regardless of which path produced them.

const MAX_CAROUSEL_CARDS = 10;

/** Subset of the link_shared event link shape we actually care about. */
export interface SlackLink {
  url: string;
  domain?: string;
}

/** Subset of the link_shared event we need to acknowledge an unfurl. */
export interface LinkSharedEventForUnfurl {
  channel?: string;
  message_ts?: string;
  unfurl_id?: string;
  source?: string;
  links?: SlackLink[];
}

/**
 * Respond to a `link_shared` event by attaching task cards to the URLs
 * Slack told us about. Uses the modern `unfurl_id + source` form of
 * chat.unfurl, falling back to the legacy `channel + ts` form only when
 * the event is missing those fields (older Slack delivery, for safety).
 *
 * Best-effort: errors from chat.unfurl are logged but never thrown. The
 * caller can fire-and-forget without try/catch.
 */
export async function unfurlTaskLinksFromEvent(
  web: WebClient,
  event: LinkSharedEventForUnfurl,
): Promise<void> {
  const links = event.links ?? [];
  if (links.length === 0) return;

  const unfurls = await buildUnfurlsMap(links);
  if (Object.keys(unfurls).length === 0) return;

  // Modern path: pass the event's unfurl_id + source straight through.
  // This is the only form Slack guarantees works across composer-preview,
  // post-send, and conversations_history surfaces. Slack's source enum is
  // closed (`composer` | `conversations_history`); anything else means
  // we received a payload we don't model yet — ignore rather than guess.
  const source = isKnownUnfurlSource(event.source) ? event.source : null;
  const args =
    event.unfurl_id && source
      ? ({ unfurl_id: event.unfurl_id, source } as const)
      : event.channel && event.message_ts
        ? ({ channel: event.channel, ts: event.message_ts } as const)
        : null;

  if (!args) {
    console.warn('[slack] link_shared missing both unfurl_id/source and channel/ts', {
      url_count: Object.keys(unfurls).length,
    });
    return;
  }

  try {
    await web.chat.unfurl({
      ...args,
      // The SDK's typing for `unfurls` predates blocks-on-unfurl; cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unfurls: unfurls as any,
    });
  } catch (err) {
    console.error('[slack] chat.unfurl failed', {
      args,
      url_count: Object.keys(unfurls).length,
      err,
    });
  }
}

function isKnownUnfurlSource(
  s: string | undefined,
): s is 'composer' | 'conversations_history' {
  return s === 'composer' || s === 'conversations_history';
}

/**
 * Build the `blocks` and/or `attachments` payload for a chat.postMessage
 * that mentions one or more task URLs. The shape varies with count:
 *
 *   - 1–10 task URLs → returns `{ blocks: [carousel] }`. Carousels stay
 *     compact even with many tasks because Slack lays the cards out
 *     horizontally with a scroll gesture.
 *
 *   - >10 task URLs → returns `{ attachments: [...] }`. Slack caps
 *     `carousel.elements` at 10, so beyond that we fall back to vertical
 *     attachments, one per task.
 *
 *   - Zero recognised task URLs → returns `{}` so callers can spread
 *     unconditionally without checking length.
 *
 * Order is preserved (URLs appear in the cards in the same order they
 * appear in the source text), and duplicate URLs are de-duped so a task
 * referenced twice in the reply doesn't render two cards.
 */
export async function buildTaskMessageExtras(
  links: SlackLink[],
): Promise<{ blocks?: Block[]; attachments?: MessageAttachment[] }> {
  if (links.length === 0) return {};
  const recognised = recogniseLinks(links);
  if (recognised.length === 0) return {};

  const taskIds = Array.from(new Set(recognised.map((r) => r.taskId)));
  const tasks = await getTasksByIds(taskIds);
  const byId = new Map(tasks.map((t) => [t.task_id, t]));

  // Walk the recognised list once, dedupe by URL, and accumulate the
  // task rows we'll actually render. Preserves source order.
  const seenUrls = new Set<string>();
  const orderedTasks: Array<{ url: string; task: TaskByIdRow }> = [];
  for (const { url, taskId } of recognised) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const t = byId.get(taskId);
    if (!t) continue;
    orderedTasks.push({ url, task: t });
  }
  if (orderedTasks.length === 0) return {};

  if (orderedTasks.length <= MAX_CAROUSEL_CARDS) {
    const carousel: SlackCarouselBlock = {
      type: 'carousel',
      block_id: 'task-carousel',
      elements: orderedTasks.map(({ url, task }) =>
        taskCard(toUnfurlShape(task, url)),
      ),
    };
    // Cast at the boundary: `carousel` isn't yet in @slack/types' KnownBlock
    // union but the API accepts it as a generic Block.
    return { blocks: [carousel as unknown as Block] };
  }

  const attachments: MessageAttachment[] = orderedTasks.map(({ url, task }) => {
    const card = taskUnfurl(toUnfurlShape(task, url));
    return {
      color: '#4A9EFF',
      fallback: task.title || task.template_name || 'Task',
      blocks: card.blocks,
    };
  });
  return { attachments };
}

/**
 * Pull URLs that match parseTaskUrl out of arbitrary message text.
 *
 * Drives the bot-reply path: after we render the agent's markdown into
 * mrkdwn, we scan it for our own task URLs to build attachments for. The
 * regex deliberately stops at `|` and `>` so it works on both raw URLs
 * and Slack's mrkdwn `<url|label>` link form.
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

// Shared between the unfurl-via-event path and the inline-attachments
// path. Builds a Slack `unfurls` map (URL → { blocks }) for chat.unfurl;
// callers that want attachments instead just iterate the same task data
// in buildTaskAttachments above.
async function buildUnfurlsMap(
  links: SlackLink[],
): Promise<Record<string, { blocks: ReturnType<typeof taskUnfurl>['blocks'] }>> {
  const recognised = recogniseLinks(links);
  if (recognised.length === 0) return {};

  const taskIds = Array.from(new Set(recognised.map((r) => r.taskId)));
  const tasks = await getTasksByIds(taskIds);
  const byId = new Map(tasks.map((t) => [t.task_id, t]));

  const unfurls: Record<string, { blocks: ReturnType<typeof taskUnfurl>['blocks'] }> = {};
  for (const { url, taskId } of recognised) {
    const t = byId.get(taskId);
    if (!t) continue;
    unfurls[url] = taskUnfurl(toUnfurlShape(t, url));
  }
  return unfurls;
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
