'use client';

import React from 'react';
import { KeyAffordance } from './KeyAffordance';
import {
  formatClock,
  formatOccupancy,
  getShortDate,
  occupancyTitle,
  OCCUPANCY_TEXT_CLASS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  type TaskRowItem,
  type TaskRowAssignee,
} from './TaskRow';
import { STATUS_ICONS, STATUS_TITLE } from '@/lib/taskStatusIcons';
import { PRIORITY_ICONS, PRIORITY_TITLE } from '@/lib/taskPriorityIcons';
import type { PropertyOccupancy } from '@/lib/types';

// Mobile counterpart to <TaskRow>. Same props (TaskRowItem) — rendered as a
// CARD inside a date section rather than a hairline-divided row:
//   - The section header carries the date, so the card has no date column.
//     Time (and, in mixed-date sections like Overdue, the date) renders
//     inline at the card's top-right via `showDateInline`.
//   - Title first; property slug underneath; status + priority + avatar
//     stack inline in a single meta row; occupancy as an italic footnote.
//
// Consumers stack cards in a `flex flex-col gap-*` container. This component
// is the canonical shared row for mobile task lists — any new mobile list
// should use it rather than re-implementing the layout.

interface MobileTaskRowProps {
  item: TaskRowItem;
  selected?: boolean;
  onClick?: () => void;
  // When the list is already scoped to a single property (Property Tasks),
  // hide the per-row property sub-label to avoid repeating it on every row.
  hideProperty?: boolean;
  // Show the scheduled date inline (top-right). For sections whose header
  // doesn't pin down the date — Overdue and Completed hold mixed dates.
  showDateInline?: boolean;
  // Optional department icon component rendered top-right of the body.
  departmentIcon?: React.ComponentType<{ className?: string }>;
}

function PriorityTag({ priority }: { priority: string }) {
  if (!priority || priority === 'low') return null;
  const colorClass =
    priority === 'urgent'
      ? 'text-red-500 dark:text-[#d97757]'
      : priority === 'high'
        ? 'text-neutral-800 dark:text-[#f0efed]'
        : 'text-neutral-500 dark:text-[#a09e9a]';
  const PriorityIcon = PRIORITY_ICONS[priority] ?? PRIORITY_ICONS.medium;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10.5px] tracking-[0.02em] font-medium pl-2 border-l border-neutral-200 dark:border-[rgba(255,255,255,0.07)] ${colorClass}`}
      title={PRIORITY_TITLE[priority] ?? priority}
    >
      <PriorityIcon size={12} strokeWidth={2} aria-hidden />
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

/**
 * Occupancy as the last line of a mobile task card — italic, so it reads as an
 * annotation about the PROPERTY rather than another attribute of the task.
 * Mobile has no room for the desktop column, so the same fact lands here.
 */
export function OccupancyFootnote({
  occupancy,
}: {
  occupancy?: PropertyOccupancy | null;
}) {
  const formatted = formatOccupancy(occupancy);
  if (!formatted || !occupancy) return null;
  return (
    <div
      className="flex items-center gap-1.5 mt-2 text-[12px] italic tracking-[0.01em] min-w-0"
      title={occupancyTitle(occupancy)}
    >
      <span
        className={`shrink-0 ${
          OCCUPANCY_TEXT_CLASS[occupancy.status] ?? OCCUPANCY_TEXT_CLASS.vacant
        }`}
      >
        {formatted.label}
      </span>
      {formatted.detail && (
        <span className="text-neutral-400 dark:text-[#66645f] truncate">
          · {formatted.detail}
        </span>
      )}
    </div>
  );
}

function AssigneeStack({ assignees }: { assignees: TaskRowAssignee[] }) {
  if (assignees.length === 0) return null;
  return (
    <div className="flex ml-auto">
      {assignees.slice(0, 3).map((u, i) => (
        <div
          key={u.user_id}
          className="w-[20px] h-[20px] rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[8px] font-semibold text-neutral-600 dark:text-[#a09e9a] overflow-hidden ring-[1.5px] ring-white dark:ring-background"
          style={{ marginLeft: i > 0 ? '-6px' : 0 }}
          title={u.name}
        >
          {u.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u.avatar}
              alt={u.name}
              className="w-full h-full object-cover"
            />
          ) : (
            u.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()
          )}
        </div>
      ))}
      {assignees.length > 3 && (
        <div
          className="w-[20px] h-[20px] rounded-full bg-neutral-100 dark:bg-[#2a2825] flex items-center justify-center text-[8px] font-semibold text-neutral-500 dark:text-[#a09e9a] ring-[1.5px] ring-white dark:ring-background"
          style={{ marginLeft: '-6px' }}
          title={`+${assignees.length - 3} more`}
        >
          +{assignees.length - 3}
        </div>
      )}
    </div>
  );
}

/**
 * The compact when-label at the card's top-right: "3:30pm", or with
 * `showDateInline` also the date — "Jul 2" / "Jul 2 · 3:30pm". Null when
 * there's nothing to say.
 */
function inlineWhenLabel(item: TaskRowItem, showDateInline: boolean): string | null {
  const time = item.scheduled_time ? formatClock(item.scheduled_time) : null;
  if (showDateInline && item.scheduled_date) {
    const d = getShortDate(item.scheduled_date);
    if (d) {
      const datePart = `${d.month} ${d.day}`;
      return time ? `${datePart} · ${time}` : datePart;
    }
  }
  return time;
}

export function MobileTaskRow({
  item,
  selected = false,
  onClick,
  hideProperty = false,
  showDateInline = false,
  departmentIcon: DeptIcon,
}: MobileTaskRowProps) {
  const whenLabel = inlineWhenLabel(item, showDateInline);
  const showDept = !!DeptIcon && !!item.department_id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`rounded-xl border px-4 py-3.5 text-left transition-colors w-full cursor-pointer shadow-[0_1px_2px_rgba(30,25,20,0.04)] ${
        selected
          ? 'border-neutral-300 dark:border-[rgba(255,255,255,0.16)] bg-[rgba(30,25,20,0.04)] dark:bg-[rgba(255,255,255,0.05)]'
          : 'border-neutral-200/70 dark:border-[rgba(255,255,255,0.07)] bg-white dark:bg-[rgba(255,255,255,0.025)] active:bg-neutral-100/50 dark:active:bg-[rgba(255,255,255,0.04)]'
      }`}
    >
      {/* Title row — when-label + dept icon pinned top-right */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
          <div className="text-[14.5px] font-medium text-neutral-800 dark:text-[#f0efed] leading-snug tracking-tight line-clamp-2 min-w-0">
            {item.title}
          </div>
          <KeyAffordance reservationId={item.reservation_id} size={12} />
        </div>
        {(whenLabel || showDept) && (
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {whenLabel && (
              <span className="text-[11px] font-medium text-neutral-400 dark:text-[#66645f] tracking-tight tabular-nums whitespace-nowrap">
                {whenLabel}
              </span>
            )}
            {showDept && DeptIcon && (
              <DeptIcon className="w-[15px] h-[15px] text-neutral-400 dark:text-[#66645f] shrink-0" />
            )}
          </div>
        )}
      </div>
      {!hideProperty && item.property_name && (
        <div className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug truncate">
          {item.property_name}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <span
          className="inline-flex items-center gap-1 text-[10.5px] tracking-[0.02em] font-medium"
          style={{ color: STATUS_COLORS[item.status] || '#A78BFA' }}
          title={STATUS_TITLE[item.status] ?? item.status}
        >
          {(() => {
            const StatusIcon = STATUS_ICONS[item.status] ?? STATUS_ICONS.not_started;
            return <StatusIcon size={12} strokeWidth={2} aria-hidden />;
          })()}
          {STATUS_LABELS[item.status] || item.status}
        </span>
        <PriorityTag priority={item.priority} />
        <AssigneeStack assignees={item.assignees} />
      </div>

      <OccupancyFootnote occupancy={item.occupancy} />
    </div>
  );
}
