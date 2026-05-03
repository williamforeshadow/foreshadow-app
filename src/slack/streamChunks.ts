import type { TaskUpdateChunk, URLSourceElement } from '@slack/types';
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
// Why no markdown_text header chunk in the stream itself:
//   chat.startStream requires `thread_ts` — Slack's API rejects
//   `invalid_arguments / missing required field: thread_ts` without
//   it. The streaming surface is fundamentally a "reply into a
//   thread" pattern, not a fresh-message pattern. So the route layer
//   posts a parent chat.postMessage carrying the header text first,
//   then streams JUST the task_update chunks as a threaded reply
//   under that parent. The header lives on the parent message, not
//   in the stream.
//
// What each task_update chunk carries:
//   - id:      task UUID (must be unique within the message)
//   - title:   task title or template-name fallback (plain text)
//   - status:  mapped onto Slack's closed enum
//              (pending | in_progress | complete | error)
//   - details: a plain-text string with "Property: …" and
//              "Scheduled: …" on separate lines. Streaming
//              `details` is a string, NOT a rich_text block —
//              simpler than the task_card equivalent.
//   - sources: a single URL chip pointing at /tasks/<id>, labelled
//              "Open in Foreshadow". Slack renders chunk sources
//              as native hyperlinks; this is the proven-reliable
//              click-through surface across DM / channel / thread.

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
 * Build the chunk array for a /myassignments streaming reply: one
 * `task_update` per assignment, in the order given.
 *
 * The header text doesn't live in this array — it's carried by the
 * parent chat.postMessage that the streaming reply threads under.
 * See the file header for why streaming requires a parent.
 */
export function buildTaskUpdateChunks(
  orderedTasks: Array<{ url: string; task: TaskByIdRow }>,
): TaskUpdateChunk[] {
  return orderedTasks.map((row) => buildTaskUpdateChunk(row));
}
