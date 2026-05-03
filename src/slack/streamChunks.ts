import type {
  AnyChunk,
  MarkdownTextChunk,
  TaskUpdateChunk,
  URLSourceElement,
} from '@slack/types';
import type { TaskByIdRow } from '@/src/server/tasks/getTaskById';
import { formatScheduled } from './unfurlBlocks';

// Streaming-chunk builders for the `/myassignments` slash command.
//
// Why streaming chunks (and not Block Kit blocks):
//   Slack's `task_card` block — the collapsible task-row visual — is
//   rejected by `chat.postMessage` with `invalid_blocks`. The Slack
//   platform 2026 changelog confirms task_card is a streaming-only
//   primitive, emitted via the `chunks` parameter of:
//
//     - chat.startStream
//     - chat.appendStream
//     - chat.stopStream
//
//   The `task_update` chunk type below is the streaming equivalent of
//   the static task_card block: same title / status / details / output
//   / sources fields, just delivered through a different transport.
//
//   See: https://docs.slack.dev/changelog/2026/02/11/task-cards-plan-blocks
//        https://docs.slack.dev/reference/methods/chat.startStream
//
// What we send for /myassignments:
//   1. One `markdown_text` chunk carrying the visible header line
//      ("Billy, you have N open assignments:") so the user has context
//      above the task rows.
//   2. One `task_update` chunk per assignment, with:
//        - id:      task UUID (must be unique within the message)
//        - title:   task title or template-name fallback (plain text)
//        - status:  mapped onto Slack's closed enum
//                   (pending | in_progress | complete | error)
//        - details: a plain-text string with "Property: …" and
//                   "Scheduled: …" on separate lines. Streaming
//                   `details` is a string, NOT a rich_text block —
//                   simpler than the task_card equivalent.
//        - sources: a single URL chip pointing at /tasks/<id>, labelled
//                   "Open in Foreshadow". Slack renders chunk sources
//                   as native hyperlinks; this is the proven-reliable
//                   click-through surface across DM / channel.
//   3. The route layer follows up with `chat.stopStream` (no extra
//      chunks) so Slack finalises the message and removes any
//      "streaming" loading indicator.

// Map Foreshadow's task status onto Slack's chunk status. Slack only
// models four states; our paused / contingent / not_started fold into
// pending because it's the closest match. /myassignments filters out
// `complete` upstream, so in practice we only emit pending or
// in_progress.
function toChunkStatus(
  s: string,
): 'pending' | 'in_progress' | 'complete' | 'error' {
  switch (s) {
    case 'in_progress':
      return 'in_progress';
    case 'complete':
      return 'complete';
    case 'not_started':
    case 'paused':
    case 'contingent':
    default:
      return 'pending';
  }
}

/**
 * Build a `task_update` chunk for one Foreshadow task.
 *
 * Mirrors the field-extraction rules used by the carousel/unfurl card
 * builders (title fallback to template name, place fallback to bin
 * name) so the same task renders consistently across surfaces.
 */
export function buildTaskUpdateChunk(args: {
  task: TaskByIdRow;
  url: string;
}): TaskUpdateChunk {
  const { task, url } = args;

  const title =
    task.title?.trim() || task.template_name?.trim() || 'Untitled task';

  // Compose the details string. One line per piece of metadata that's
  // present; skip lines whose value is missing so the expanded card
  // stays tight (better to omit a row than render "Scheduled: —").
  const detailLines: string[] = [];
  const place = task.property_name?.trim() || task.bin_name?.trim();
  if (place) detailLines.push(`Property: ${place}`);
  const scheduled = formatScheduled(task.scheduled_date, task.scheduled_time);
  if (scheduled) detailLines.push(`Scheduled: ${scheduled}`);

  // The single click-through. URLSourceElement renders as a native
  // hyperlink chip in the expanded chunk view — no button, no
  // interactivity ack, just standard URL navigation.
  const sources: URLSourceElement[] = [
    { type: 'url', url, text: 'Open in Foreshadow' },
  ];

  const chunk: TaskUpdateChunk = {
    type: 'task_update',
    id: task.task_id,
    title,
    status: toChunkStatus(task.status),
    sources,
  };
  if (detailLines.length > 0) chunk.details = detailLines.join('\n');
  return chunk;
}

/**
 * Build the full chunk array for a /myassignments response: one header
 * `markdown_text` chunk followed by one `task_update` per assignment.
 *
 * Returned as `AnyChunk[]` so the route layer can pass it directly to
 * `chat.startStream({ chunks })` without further casting.
 */
export function buildAssignmentChunks(args: {
  headerText: string;
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>;
}): AnyChunk[] {
  const { headerText, orderedTasks } = args;
  const header: MarkdownTextChunk = {
    type: 'markdown_text',
    text: headerText,
  };
  const taskChunks = orderedTasks.map((row) => buildTaskUpdateChunk(row));
  return [header, ...taskChunks];
}
