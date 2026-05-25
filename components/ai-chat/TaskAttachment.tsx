'use client';

import { TaskListHeader, TaskRow } from '@/components/tasks/TaskRow';
import type { TaskRow as AgentTaskRow } from '@/src/agent/tools/findTasks';
import { Attachment } from './Attachment';
import { taskRowToRowItem } from './taskRowMapping';

// First consumer of the generic Attachment shell. Renders a collapsed
// "{N} tasks" bar that expands to the same task-row format used on the
// My Assignments and Tasks pages — so chat results read the same way the
// rest of the app reads.
//
// Chat-context column choice: only "when", "task" (title + status +
// priority icons), and "assignee" are kept. Department, bin, and
// comments are dropped — they don't fit in the docked panel and add
// noise when the user is having a conversation rather than triaging.
//
// Pattern for future visual types: copy this file, swap TaskRow for the
// relevant row/card component, supply the appropriate title.
export function TaskAttachment({
  cards,
  onOpen,
}: {
  cards: AgentTaskRow[];
  onOpen: (taskUrl: string) => void;
}) {
  return (
    <Attachment title={`${cards.length} tasks`}>
      <TaskListHeader hideDepartment hideBin hideComments />
      {cards.map((t, idx) => (
        <TaskRow
          key={t.task_id}
          item={taskRowToRowItem(t)}
          onClick={() => onOpen(t.task_url)}
          isLast={idx === cards.length - 1}
          hideDepartment
          hideBin
          hideComments
        />
      ))}
    </Attachment>
  );
}
