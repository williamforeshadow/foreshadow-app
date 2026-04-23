'use client';

import React from 'react';

// Shared row + visual constants used across task-list surfaces (My Assignments,
// Property Tasks, and anywhere else we render the "status marble" list design).
//
// Every consumer should render rows through <TaskRow /> so visual changes
// propagate uniformly. Grouping, filtering, sorting, and detail-panel wiring
// stay per-consumer (each surface has its own rules for what "due" means).

// ---- Types -----------------------------------------------------------------

export interface TaskRowAssignee {
  user_id: string;
  name: string;
  avatar: string | null;
}

export interface TaskRowItem {
  // Stable key, must be unique within a list.
  key: string;
  title: string;
  property_name?: string | null;
  status: string;
  priority: string;
  department_id?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  assignees: TaskRowAssignee[];
  // Optional ledger metadata. When provided + the corresponding show flag is
  // on, the row renders inline indicators.
  bin_id?: string | null;
  bin_name?: string | null;
  is_binned?: boolean;
  is_recurring?: boolean;
}

// ---- Status + priority visual constants ------------------------------------
// Exported so consumers can render matching legends / filter chips.

export const STATUS_COLORS: Record<string, string> = {
  not_started: '#A78BFA',
  in_progress: '#6366F1',
  paused: '#8B7FA8',
  complete: '#4C4869',
};

export const STATUS_MARBLE: Record<string, string> = {
  not_started:
    'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.35) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.18) 10%, transparent 40%, rgba(255,255,255,0.12) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #A78BFA',
  in_progress:
    'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.18) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #6366F1',
  paused:
    'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.15) 10%, transparent 40%, rgba(255,255,255,0.1) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.08) 0%, transparent 55%), #8B7FA8',
  complete:
    'radial-gradient(ellipse at 25% 35%, rgba(255,255,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 45%), linear-gradient(155deg, rgba(255,255,255,0.12) 10%, transparent 40%, rgba(255,255,255,0.08) 75%), radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.1) 0%, transparent 55%), #4C4869',
};

export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
};

export const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// ---- Small sub-components --------------------------------------------------

export function PriorityTag({ priority }: { priority: string }) {
  if (!priority || priority === 'low') return null;
  const colorClass =
    priority === 'urgent'
      ? 'text-red-500 dark:text-[#d97757]'
      : priority === 'high'
      ? 'text-neutral-800 dark:text-[#f0efed]'
      : 'text-neutral-500 dark:text-[#a09e9a]';
  return (
    <span
      className={`text-[11px] tracking-[0.02em] font-medium pl-2 border-l border-neutral-200 dark:border-[rgba(255,255,255,0.07)] ${colorClass}`}
    >
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

// Archive-drawer icon — matches the bin iconography in
// `components/windows/projects/BinPicker.tsx` (the "All Binned Tasks" card).
export function BinIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  );
}

// Circular arrow — recurring / auto-generated.
export function RecurringIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0113.7-3.3L20 9M20 15a8 8 0 01-13.7 3.3L4 15"
      />
    </svg>
  );
}

// ---- Date / time formatting helpers ----------------------------------------

export function formatTimeCol(timeString?: string | null): {
  time: string;
  meridiem: string;
} | null {
  if (!timeString) return null;
  const [h, m] = timeString.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return { time: `${hour12}:${String(m).padStart(2, '0')}`, meridiem: ampm };
}

export function getDayLabel(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
}

export function getShortDate(
  dateStr?: string | null
): { month: string; day: number } | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return { month, day: date.getDate() };
}

// ---- TaskRow ---------------------------------------------------------------

interface TaskRowProps {
  item: TaskRowItem;
  selected?: boolean;
  isLast?: boolean;
  onClick?: () => void;
  // When the surrounding list is inherently about a single property, hide the
  // per-row property sub-label to reduce noise (every row would repeat it).
  hideProperty?: boolean;
  showBinPill?: boolean;
  showRecurringPill?: boolean;
  // Optional department icon (rendered at the row's top-right).
  departmentIcon?: React.ComponentType<{ className?: string }>;
}

export function TaskRow({
  item,
  selected = false,
  isLast = false,
  onClick,
  hideProperty = false,
  showBinPill = false,
  showRecurringPill = false,
  departmentIcon: DeptIcon,
}: TaskRowProps) {
  const timeInfo = formatTimeCol(item.scheduled_time);
  const dayLabel = getDayLabel(item.scheduled_date);
  const shortDate = getShortDate(item.scheduled_date);

  return (
    <button
      onClick={onClick}
      className={`grid grid-cols-[56px_1fr] gap-4 py-3.5 text-left transition-colors ${
        selected
          ? 'bg-[rgba(30,25,20,0.04)] dark:bg-[rgba(255,255,255,0.04)]'
          : 'hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)]'
      } ${
        !isLast
          ? 'border-b border-[rgba(30,25,20,0.08)] dark:border-[rgba(255,255,255,0.07)]'
          : ''
      } rounded-lg px-3 -mx-3`}
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              {showRecurringPill && item.is_recurring && (
                <RecurringIcon className="w-[11px] h-[11px] text-neutral-400 dark:text-[#66645f] shrink-0" />
              )}
              <div className="text-[14px] font-medium text-neutral-800 dark:text-[#f0efed] leading-snug tracking-tight truncate">
                {item.title}
              </div>
            </div>
            {!hideProperty && item.property_name && (
              <div className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug truncate">
                {item.property_name}
              </div>
            )}
          </div>
          {DeptIcon && (
            <DeptIcon className="w-[15px] h-[15px] text-neutral-400 dark:text-[#66645f] shrink-0 mt-0.5" />
          )}
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-2 mt-2">
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{
              background:
                STATUS_MARBLE[item.status] || STATUS_MARBLE.not_started,
            }}
          />
          <span
            className="text-[11px] tracking-[0.02em] font-medium"
            style={{ color: STATUS_COLORS[item.status] || '#A78BFA' }}
          >
            {STATUS_LABELS[item.status] || item.status}
          </span>
          <PriorityTag priority={item.priority} />

          {/* Bin indicator (archive-drawer icon + optional name) */}
          {showBinPill && item.is_binned && (
            <span
              className="flex items-center gap-1 pl-2 border-l border-neutral-200 dark:border-[rgba(255,255,255,0.07)] text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] tracking-[0.02em] min-w-0"
              title={item.bin_name ? `In bin: ${item.bin_name}` : 'Binned'}
            >
              <BinIcon className="w-[11px] h-[11px] shrink-0" />
              {item.bin_name && (
                <span className="truncate max-w-[120px]">{item.bin_name}</span>
              )}
            </span>
          )}

          {/* Assignee avatars pushed right */}
          {item.assignees.length > 0 && (
            <div className="flex ml-auto">
              {item.assignees.slice(0, 3).map((u, i) => (
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
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
