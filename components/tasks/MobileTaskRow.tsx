'use client';

import React from 'react';
import { KeyAffordance } from './KeyAffordance';
import {
  formatTimeCol,
  getDayLabel,
  getShortDate,
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_MARBLE,
  type TaskRowItem,
  type TaskRowAssignee,
} from './TaskRow';

// Mobile counterpart to <TaskRow>. Same props (TaskRowItem) — different
// visual layout:
//   - Two-column grid [44px | 1fr] (date/time | body)
//   - Title first; property slug underneath; marble dot + status + priority
//     + avatar stack all inline in a single meta row
//   - Department icon pinned to the top-right of the body
//   - No column labels, no separate columns for assignee / dept name / bin
//     / comments (mobile doesn't need to fill horizontal space)
//
// Mirrors the row rendering that already exists inside
// MobileMyAssignmentsView so both mobile surfaces feel identical. This
// component is the canonical shared row for mobile task lists — any new
// mobile list (Schedule tasks, a future Bins mobile view, etc.) should use
// it rather than re-implementing the layout.

interface MobileTaskRowProps {
  item: TaskRowItem;
  selected?: boolean;
  isLast?: boolean;
  onClick?: () => void;
  // When the list is already scoped to a single property (Property Tasks),
  // hide the per-row property sub-label to avoid repeating it on every row.
  hideProperty?: boolean;
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
  return (
    <span
      className={`text-[10.5px] tracking-[0.02em] font-medium pl-2 border-l border-neutral-200 dark:border-[rgba(255,255,255,0.07)] ${colorClass}`}
    >
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

function AssigneeStack({ assignees }: { assignees: TaskRowAssignee[] }) {
  if (assignees.length === 0) return null;
  return (
    <div className="flex ml-auto">
      {assignees.slice(0, 3).map((u, i) => (
        <div
          key={u.user_id}
          className="w-[20px] h-[20px] rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[8px] font-semibold text-neutral-600 dark:text-[#a09e9a] overflow-hidden ring-[1.5px] ring-white dark:ring-[#0b0b0c]"
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
          className="w-[20px] h-[20px] rounded-full bg-neutral-100 dark:bg-[#2a2825] flex items-center justify-center text-[8px] font-semibold text-neutral-500 dark:text-[#a09e9a] ring-[1.5px] ring-white dark:ring-[#0b0b0c]"
          style={{ marginLeft: '-6px' }}
          title={`+${assignees.length - 3} more`}
        >
          +{assignees.length - 3}
        </div>
      )}
    </div>
  );
}

export function MobileTaskRow({
  item,
  selected = false,
  isLast = false,
  onClick,
  hideProperty = false,
  departmentIcon: DeptIcon,
}: MobileTaskRowProps) {
  const timeInfo = formatTimeCol(item.scheduled_time);
  const dayLabel = getDayLabel(item.scheduled_date);
  const shortDate = getShortDate(item.scheduled_date);

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
      className={`grid grid-cols-[44px_1fr] gap-3.5 py-3.5 text-left transition-colors w-full cursor-pointer ${
        selected
          ? 'bg-[rgba(30,25,20,0.04)] dark:bg-[rgba(255,255,255,0.04)]'
          : 'active:bg-neutral-100/50 dark:active:bg-[rgba(255,255,255,0.03)]'
      } ${
        !isLast
          ? 'border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)]'
          : ''
      }`}
    >
      {/* Date/time column */}
      <div className="text-right pt-0.5">
        {item.scheduled_date || timeInfo ? (
          <>
            {shortDate && (
              <>
                {dayLabel && (
                  <div className="text-[9px] text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.06em] font-medium mb-0.5">
                    {dayLabel}
                  </div>
                )}
                <div className="text-[12px] font-semibold text-neutral-800 dark:text-[#f0efed] leading-none tracking-tight whitespace-nowrap">
                  {shortDate.month} {shortDate.day}
                </div>
              </>
            )}
            {timeInfo && (
              <div className={item.scheduled_date ? 'mt-1' : ''}>
                <div className="text-[10px] font-medium text-neutral-400 dark:text-[#66645f] leading-none tracking-tight tabular-nums whitespace-nowrap">
                  {timeInfo.time}
                  {timeInfo.meridiem.toLowerCase()}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-[9px] text-neutral-300 dark:text-[#3e3d3a] uppercase tracking-[0.08em] font-medium leading-snug pt-0.5">
            no
            <br />
            date
          </div>
        )}
      </div>

      {/* Body */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
            <div className="text-[14.5px] font-medium text-neutral-800 dark:text-[#f0efed] leading-snug tracking-tight line-clamp-2 min-w-0">
              {item.title}
            </div>
            <KeyAffordance reservationId={item.reservation_id} size={12} />

          </div>
          {DeptIcon && item.department_id && (
            <DeptIcon className="w-[15px] h-[15px] text-neutral-400 dark:text-[#66645f] shrink-0 mt-0.5" />
          )}
        </div>
        {!hideProperty && item.property_name && (
          <div className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug truncate">
            {item.property_name}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{
              background:
                STATUS_MARBLE[item.status] || STATUS_MARBLE.not_started,
            }}
          />
          <span
            className="text-[10.5px] tracking-[0.02em] font-medium"
            style={{ color: STATUS_COLORS[item.status] || '#A78BFA' }}
          >
            {STATUS_LABELS[item.status] || item.status}
          </span>
          <PriorityTag priority={item.priority} />
          <AssigneeStack assignees={item.assignees} />
        </div>
      </div>
    </div>
  );
}
