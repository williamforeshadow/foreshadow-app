'use client';

import { ProjectCard } from '@/components/windows/projects/ProjectCard';
import type { TaskRow } from '@/src/agent/tools/findTasks';
import { Attachment } from './Attachment';
import { taskRowToCardItem } from './taskCardMapping';

// First consumer of the generic Attachment shell. Renders a collapsed
// "{N} tasks" bar that expands to a vertical scroll of full kanban-style
// task cards. Each card is clickable and opens the task via the caller's
// `onOpen` callback (same route as the inline carousel uses).
//
// Pattern for future visual types: copy this file, swap ProjectCard for
// the relevant card component, supply the appropriate title.
export function TaskAttachment({
  cards,
  onOpen,
}: {
  cards: TaskRow[];
  onOpen: (taskUrl: string) => void;
}) {
  return (
    <Attachment title={`${cards.length} tasks`}>
      {cards.map((t) => (
        <div
          key={t.task_id}
          role="button"
          tabIndex={0}
          className="cursor-pointer [&>div]:!cursor-pointer"
          onClick={() => onOpen(t.task_url)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(t.task_url);
            }
          }}
        >
          <ProjectCard
            item={taskRowToCardItem(t)}
            viewMode="status"
            isDragging={false}
          />
        </div>
      ))}
    </Attachment>
  );
}
