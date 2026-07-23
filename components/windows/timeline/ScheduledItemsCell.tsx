'use client';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HoverCardArrow,
} from '@/components/ui/hover-card';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import type { Task } from '@/lib/types';
import { marbleBackground } from './timelineStatus';
import { TaskRowList } from './TaskRowList';

interface ScheduledItemsCellProps {
  propertyName: string;
  date: Date;
  tasks: (Task & { property_name: string })[];
  projects?: never[];
  viewMode?: 'week' | 'month';
  expanded?: boolean;
  onTaskClick?: (task: Task) => void;
}

// Week-only: how many task icons fit before collapsing into a "+N" chip.
// (Month renders nothing in the collapsed main row — see early return below.)
const WEEK_ICON_CAP = 3;

// Stable left-to-right order: timed tasks first (ascending), untimed last,
// then by title — so the same cell always renders in the same sequence.
const byScheduleThenTitle = (a: Task, b: Task) => {
  const ta = a.scheduled_time || '';
  const tb = b.scheduled_time || '';
  if (ta && tb && ta !== tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  const na = a.title || a.template_name || 'Task';
  const nb = b.title || b.template_name || 'Task';
  return na.localeCompare(nb);
};

/**
 * Drag wrapper: makes a task icon/dot draggable to reschedule it onto another
 * day. The grid-level DndContext (TimelineWindow) handles drop → reschedule.
 * The child keeps its own onClick — a MouseSensor activation distance
 * separates a click (open task) from a drag.
 */
function DraggableTask({
  task,
  propertyName,
  cellDateStr,
  children,
}: {
  task: Task;
  propertyName: string;
  cellDateStr: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.task_id,
    data: {
      taskId: task.task_id,
      property: propertyName,
      scheduledTime: task.scheduled_time ?? null,
      currentDate: cellDateStr,
      status: task.status,
    },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('inline-flex', isDragging && 'opacity-50')}
    >
      {children}
    </div>
  );
}

/** One task = one icon: department glyph on a status-marble background. */
function TaskIcon({
  task,
  size,
  onClick,
}: {
  task: Task;
  size: 'week' | 'month';
  onClick?: (task: Task) => void;
}) {
  const { departments } = useDepartments();
  const dept = departments.find((d) => d.id === task.department_id);
  const Icon = getDepartmentIcon(dept?.icon);
  const isContingent = task.status === 'contingent';
  const box = size === 'week' ? 'w-[22px] h-[22px]' : 'w-[18px] h-[18px]';
  const glyph = size === 'week' ? 'w-3.5 h-3.5' : 'w-3 h-3';

  return (
    <div
      role="button"
      tabIndex={0}
      title={task.title || task.template_name || 'Task'}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(task);
      }}
      className={cn(
        'flex items-center justify-center rounded shadow-sm transition-all cursor-pointer hover:brightness-110 hover:scale-110 relative overflow-hidden text-white',
        box,
        isContingent &&
          'border-[1.5px] border-dashed border-[rgba(30,25,20,0.25)] dark:border-[rgba(255,255,255,0.35)] bg-white dark:bg-[var(--timeline-surface-3)] text-[#1a1a18] dark:text-white',
      )}
      style={
        isContingent
          ? undefined
          : { background: marbleBackground[task.status] || marbleBackground.not_started }
      }
    >
      <Icon className={glyph} />
    </div>
  );
}

export function ScheduledItemsCell({
  propertyName,
  date,
  tasks,
  viewMode = 'week',
  expanded = false,
  onTaskClick,
}: ScheduledItemsCellProps) {
  // Format the cell date as YYYY-MM-DD for direct string comparison
  const cellDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  // Filter tasks scheduled for this property + date, then order them.
  const scheduledTasks = tasks
    .filter(
      (t) =>
        t.property_name === propertyName &&
        t.scheduled_date &&
        t.scheduled_date === cellDateStr,
    )
    .sort(byScheduleThenTitle);

  if (scheduledTasks.length === 0) {
    return null;
  }

  // Month view: status dots directly in the cell (mobile-style) — no hover
  // popover and no chevron-expand for month (gated off in TimelineWindow).
  // Dots are individually clickable to open the task; the cell itself opens
  // the reservation, so stop propagation.
  if (viewMode === 'month') {
    return (
      <div className="absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap items-end gap-0.5 z-[16]">
        {scheduledTasks.map((task) => {
          const isContingent = task.status === 'contingent';
          return (
            <DraggableTask
              key={task.task_id}
              task={task}
              propertyName={propertyName}
              cellDateStr={cellDateStr}
            >
              <span
                role="button"
                tabIndex={0}
                title={task.title || task.template_name || 'Task'}
                onClick={(e) => {
                  e.stopPropagation();
                  onTaskClick?.(task);
                }}
                className={cn(
                  'w-2.5 h-2.5 rounded-full shrink-0 cursor-pointer',
                  isContingent &&
                    'border border-dashed border-[rgba(30,25,20,0.4)] dark:border-[rgba(255,255,255,0.4)]',
                )}
                style={
                  isContingent
                    ? undefined
                    : { background: marbleBackground[task.status] || marbleBackground.not_started }
                }
              />
            </DraggableTask>
          );
        })}
      </div>
    );
  }

  const cap = WEEK_ICON_CAP;
  const visible = scheduledTasks.slice(0, cap);
  const overflow = scheduledTasks.length - visible.length;

  const iconRow = (
    <div className="flex items-center gap-0.5">
      {visible.map((task) => (
        <DraggableTask
          key={task.task_id}
          task={task}
          propertyName={propertyName}
          cellDateStr={cellDateStr}
        >
          <TaskIcon task={task} size={viewMode} onClick={onTaskClick} />
        </DraggableTask>
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            'flex items-center justify-center rounded px-1 font-medium text-[10px] shadow-sm',
            'bg-white/90 dark:bg-[var(--timeline-surface-3)] text-[#1a1a18] dark:text-white border border-[rgba(30,25,20,0.12)] dark:border-[var(--timeline-border-strong)]',
            viewMode === 'week' ? 'h-[22px] min-w-5' : 'h-[18px] min-w-4',
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );

  return (
    <div className="absolute bottom-0.5 left-0.5 z-[16]">
      {expanded ? (
        // Property row is expanded — the full per-task list renders in the
        // detail row below (same TaskRowList), so the cell shows icons only.
        iconRow
      ) : (
        <HoverCard openDelay={0} closeDelay={100}>
          <HoverCardTrigger asChild>
            <div className="cursor-pointer">{iconRow}</div>
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={16}
            className="w-72 p-1 bg-white dark:bg-[var(--timeline-surface-4)] border border-[rgba(30,25,20,0.08)] dark:border-[var(--timeline-border-strong)] shadow-lg"
          >
            <HoverCardArrow className="fill-white dark:fill-[var(--timeline-surface-4)]" />
            <div className="max-h-48 overflow-y-auto subtle-scrollbar">
              <TaskRowList tasks={scheduledTasks} onTaskClick={(t) => onTaskClick?.(t)} />
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}
