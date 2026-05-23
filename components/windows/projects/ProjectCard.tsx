'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { STATUS_ICONS, STATUS_TITLE } from '@/lib/taskStatusIcons';
import { PRIORITY_ICONS, PRIORITY_TITLE } from '@/lib/taskPriorityIcons';
import { useDepartments } from '@/lib/departmentsContext';
import type { Project, ProjectViewMode, ProjectBin } from '@/lib/types';
import type { KanbanItemProps } from '@/lib/kanban-helpers';
import styles from './ProjectsKanban.module.css';

// The kanban draggable wrapper around a Project. Defined here because the
// card is the primary consumer; ProjectsKanban imports it back.
export interface DraggableProjectItem extends KanbanItemProps {
  id: string;
  columnId: string;
  project: Project;
}

// Minute-level ticker so countdown badges update live without reading
// Date.now() on every render / re-mount of a card.
function useMinuteTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 60_000);
    return () => clearInterval(id);
  }, [enabled]);
}

function formatAutoDismissLabel(completedAt: string, days: number): { text: string } | null {
  const completedMs = new Date(completedAt).getTime();
  if (!Number.isFinite(completedMs)) return null;
  const deadlineMs = completedMs + days * 24 * 60 * 60 * 1000;
  const remainingMs = deadlineMs - Date.now();
  // Past deadline: hide entirely. The hourly sweep will remove the task from
  // the bin server-side; the UI just goes quiet in the meantime.
  if (remainingMs <= 0) return null;
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const d = Math.floor(totalMinutes / (60 * 24));
  const h = Math.floor((totalMinutes % (60 * 24)) / 60);
  const m = totalMinutes % 60;
  if (d >= 1) return { text: `dismissing in ${d}d ${h}h` };
  if (h >= 1) return { text: `dismissing in ${h}h ${m}m` };
  return { text: `dismissing in ${m}m` };
}

// ============================================================================
// Card Content (used in sortable cards, the drag overlay, and the AI chat)
// ============================================================================

export function ProjectCard({
  item,
  viewMode,
  isDragging = false,
  isSelected = false,
  unreadCount = 0,
  selectionMode = false,
  isChecked = false,
  bin,
}: {
  item: DraggableProjectItem;
  viewMode: ProjectViewMode;
  isDragging?: boolean;
  isSelected?: boolean;
  unreadCount?: number;
  selectionMode?: boolean;
  isChecked?: boolean;
  bin?: ProjectBin;
}) {
  const project = item.project;
  const { departments: allDepts } = useDepartments();
  const dept = allDepts.find(d => d.id === project.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);

  // Auto-dismiss countdown — only relevant for completed binned tasks whose
  // bin has auto-dismiss enabled.
  const autoDismissActive =
    project.status === 'complete' &&
    !!project.is_binned &&
    !!project.completed_at &&
    !!bin?.auto_dismiss_enabled;
  useMinuteTick(autoDismissActive);
  const autoDismiss = autoDismissActive
    ? formatAutoDismissLabel(project.completed_at as string, bin?.auto_dismiss_days ?? 7)
    : null;

  // Assignees
  const assignees: { id: string; name: string; avatar?: string }[] = [];
  if (project.project_assignments) {
    project.project_assignments.forEach((a) => {
      assignees.push({
        id: a.user_id,
        name: a.user?.name || '?',
        avatar: a.user?.avatar,
      });
    });
  }

  const getStatusClass = (status: string | undefined) => {
    switch (status) {
      case 'complete':
        return styles.statusComplete;
      case 'in_progress':
        return styles.statusInProgress;
      case 'paused':
        return styles.statusPaused;
      default:
        return styles.statusNotStarted;
    }
  };

  const getCardStatusClass = (status: string | undefined) => {
    switch (status) {
      case 'complete':
        return styles.cardStatusComplete;
      case 'in_progress':
        return styles.cardStatusInProgress;
      case 'paused':
        return styles.cardStatusPaused;
      default:
        return styles.cardStatusNotStarted;
    }
  };

  const getPriorityClass = (priority: string | undefined) => {
    switch (priority) {
      case 'urgent':
        return styles.priorityUrgent;
      case 'high':
        return styles.priorityHigh;
      case 'medium':
        return styles.priorityMedium;
      default:
        return styles.priorityLow;
    }
  };

  // Decide what subtitle to show based on view mode
  // Don't repeat information that's already the column header
  const subtitle =
    viewMode === 'property'
      ? null
      : project.property_name || null;

  return (
    <div
      className={cn(
        styles.card,
        getCardStatusClass(project.status),
        project.status === 'complete' && styles.cardDimmed,
        isDragging && styles.cardDragging,
        selectionMode && styles.cardSelectable,
        selectionMode && isChecked && styles.cardChecked,
      )}
      style={isSelected && !selectionMode ? { boxShadow: '0 0 0 1.5px currentColor', opacity: 1 } : undefined}
    >
      {/* Unread badge — hidden during selection mode to keep the card clean */}
      {unreadCount > 0 && !isSelected && !selectionMode && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#d97757',
            color: '#fff',
            fontSize: '0.625rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            zIndex: 2,
          }}
        >
          {unreadCount}
        </div>
      )}

      {/* Card Header — title · dept icon. In selection mode, the selected
          state is expressed purely through a background tone on the card,
          not a checkbox, to keep the card minimal. */}
      <div className={styles.cardHeader}>
        <div className={styles.cardContent}>
          <p className={styles.cardTitle}>{project.title}</p>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
        <div className={styles.cardIcon}>
          <DeptIcon className="w-3 h-3" />
        </div>
      </div>

      {/* Card Footer */}
      <div className={styles.cardFooter}>
        {/* Left: status + priority + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem', flexWrap: 'wrap' }}>
          <span
            className={cn(styles.statusBadge, getStatusClass(project.status))}
            title={STATUS_TITLE[project.status] ?? STATUS_TITLE.not_started}
          >
            {(() => {
              const StatusIcon =
                STATUS_ICONS[project.status] ?? STATUS_ICONS.not_started;
              return <StatusIcon size={14} strokeWidth={2} aria-hidden />;
            })()}
          </span>
          {viewMode !== 'priority' && (
            <span
              className={cn(styles.priorityBadge, getPriorityClass(project.priority))}
              title={PRIORITY_TITLE[project.priority] ?? PRIORITY_TITLE.medium}
            >
              {(() => {
                const PriorityIcon =
                  PRIORITY_ICONS[project.priority] ?? PRIORITY_ICONS.medium;
                return <PriorityIcon size={14} strokeWidth={2} aria-hidden />;
              })()}
            </span>
          )}
          {project.scheduled_date && (
            <span style={{ fontSize: '0.6625rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'rgba(30, 25, 20, 0.35)' }} className="dark:!text-[#66645f]">
              {new Date(`${project.scheduled_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {project.scheduled_time && (() => {
            const [h, m] = project.scheduled_time!.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return (
              <span style={{ fontSize: '0.6625rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'rgba(30, 25, 20, 0.35)' }} className="dark:!text-[#66645f]">
                {h12}:{String(m).padStart(2, '0')} {ampm}
              </span>
            );
          })()}
        </div>

        {/* Right: assignee avatars */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {viewMode !== 'assignee' && assignees.length > 0 && (
            <>
              {assignees.slice(0, 3).map((user, index) => (
                <div
                  key={user.id}
                  className="bg-neutral-200 dark:bg-neutral-700 ring-2 ring-white dark:ring-[#222228]"
                  style={{
                    width: 21,
                    height: 21,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.53125rem',
                    fontWeight: 600,
                    marginLeft: index > 0 ? -6 : 0,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                  title={user.name}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span className="text-neutral-500 dark:text-[#a09e9a]">
                      {user.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
              {assignees.length > 3 && (
                <div
                  className="bg-neutral-300 dark:bg-neutral-600 ring-2 ring-white dark:ring-[#222228] text-neutral-500 dark:text-[#a09e9a]"
                  style={{
                    width: 21,
                    height: 21,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.53125rem',
                    fontWeight: 600,
                    marginLeft: -6,
                    flexShrink: 0,
                  }}
                >
                  +{assignees.length - 3}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Auto-dismiss countdown — only shown on completed binned cards when
          the containing bin has auto-dismiss enabled and the deadline hasn't
          yet passed. */}
      {autoDismiss && (
        <div
          className={styles.autoDismissRow}
          title="This task will be automatically removed from its bin"
        >
          <svg className={styles.autoDismissIcon} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={styles.autoDismissLabel}>{autoDismiss.text}</span>
        </div>
      )}

      {/* Template row — signals that status is checklist-driven.
          Only shown for templated tasks. */}
      {project.template_id && project.template_name && (
        <div className={styles.templateRow} title="Status is controlled by this task's checklist">
          <svg className={styles.templateIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className={styles.templateName}>{project.template_name}</span>
        </div>
      )}
    </div>
  );
}
