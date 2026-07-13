'use client';

import { useMemo, useState } from 'react';
import { MoveRight } from 'lucide-react';
import { canonicalChannelLabel } from '@/lib/bookingChannel';
import { stageMeta } from '@/components/messages/stage';
import { ProjectCard, type DraggableProjectItem } from '@/components/windows/projects/ProjectCard';
import { ProposedTask, type ProposedTaskData } from '@/components/messages/ProposedTask';
import { filterTasksInTurnoverWindow } from '@/components/properties/schedule/scheduleDates';
import { useOperationsSettings } from '@/lib/operationsSettingsContext';
import { deriveReservationStatus, type ConversationRow } from '@/lib/conversations';
import type { ProjectStatus, ProjectPriority, User } from '@/lib/types';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import {
  useReservationContext,
  type ReservationContextTask,
} from '@/components/messages/useReservationContext';

// Right-hand context panel for the open conversation: the stay at a glance on
// top (property, dates, progress through the stay), then associated tasks. For
// inquiry threads (no booked reservation) it shows the guest + property from
// the conversation and a "no booking yet" note.

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  // d is YYYY-MM-DD; format without timezone shifting.
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${day}, ${y}`;
}

function nightsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

// How far through the stay we are, 0..1 — display-only, derived from the same
// dates the panel already shows. Null when the dates can't support it.
function stayProgress(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  const now = Date.now();
  return Math.min(1, Math.max(0, (now - s) / (e - s)));
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}

// Adapt an associated turnover task into the shape the kanban/proposal
// ProjectCard renders, so tasks on the reservation panel look identical to
// tasks everywhere else in the app (bins, schedule, task proposals) rather than
// a bespoke row. Mirrors proposedTaskToCardItem in ProposedTask.tsx.
function reservationTaskToCardItem(t: ReservationContextTask): DraggableProjectItem {
  const project_assignments = (t.assigned_users ?? []).map((u) => ({
    user_id: u.user_id,
    user: { id: u.user_id, name: u.name, avatar: u.avatar ?? undefined } as User,
  }));
  return {
    id: t.task_id,
    columnId: 'associated',
    project: {
      id: t.task_id,
      title: t.title || t.template_name || 'Task',
      property_name: t.property_name,
      status: (t.status || 'not_started') as ProjectStatus,
      priority: (t.priority || 'medium') as ProjectPriority,
      department_id: t.department_id,
      department_name: t.department_name,
      template_id: t.template_id,
      template_name: t.template_name,
      project_assignments,
      scheduled_date: t.scheduled_date ?? null,
      scheduled_time: t.scheduled_time ?? null,
      created_at: '',
      updated_at: '',
    },
  };
}

export function ConversationDetailPanel({
  conversation,
  onOpenTask,
  tasksRefreshKey = 0,
  proposedTasks = [],
  onOpenProposal,
  onProposedTaskChange,
}: {
  conversation: ConversationRow | undefined;
  /** Open an associated task in the standard task detail panel. */
  onOpenTask?: (task: ReservationContextTask) => void;
  /** Bump to re-fetch the associated tasks (e.g. after an edit in the panel). */
  tasksRefreshKey?: number;
  /** The conversation's task proposals (pending + accepted); filtered to pending
   *  here and surfaced under the tasks section's Proposed toggle. */
  proposedTasks?: ProposedTaskData[];
  /** Open a proposal in the task editor (the page-level overlay). */
  onOpenProposal?: (proposal: ProposedTaskData) => void;
  /** Re-fetch after a proposal is accepted/dismissed from the panel. */
  onProposedTaskChange?: () => void;
}) {
  const reservationId = conversation?.reservation_id ?? null;
  const { reservation, tasks, loading } = useReservationContext(
    reservationId,
    tasksRefreshKey,
  );

  // The endpoint returns a coarse date-range set; narrow it to the precise
  // turnover window [check_in @ check-in-time, next_check_in @ check-in-time)
  // — the same filter the turnovers-page ReservationDetailPanel applies, so the
  // two panels list identical associated tasks. Check-in time is the org-wide
  // default from operations_settings (there's no per-property check-in time).
  const { settings } = useOperationsSettings();
  const defaultCheckInTime = (settings.default_check_in_time || '15:00').slice(0, 5);
  const windowedTasks = useMemo(
    () =>
      filterTasksInTurnoverWindow(tasks, {
        checkIn: reservation?.check_in ?? null,
        nextCheckIn: reservation?.next_check_in ?? null,
        checkInTime: defaultCheckInTime,
      }),
    [tasks, reservation?.check_in, reservation?.next_check_in, defaultCheckInTime],
  );

  // Associated (created) vs Proposed toggle for the tasks section. Reset to the
  // primary "associated" view whenever the open conversation changes.
  const [taskView, setTaskView] = useState<'associated' | 'proposed'>('associated');
  const [prevConvId, setPrevConvId] = useState<string | undefined>(conversation?.id);
  if (conversation?.id !== prevConvId) {
    setPrevConvId(conversation?.id);
    setTaskView('associated');
  }

  if (!conversation) return null;

  // Inquiry vs booked is driven by the conversation's own booking_state, NOT by
  // whether a reservation row is linked — a conversation can be booked before
  // its reservation has synced/linked, in which case we show what we have.
  const isInquiry = conversation.booking_state === 'inquiry';
  const isCancelled = conversation.booking_state === 'cancelled';
  const hasReservation = !!reservationId;
  const guestName =
    reservation?.guest_name ?? conversation.guest_name ?? 'Guest';
  const propertyName =
    reservation?.property_name ?? conversation.property_name ?? null;
  const channel = conversation.channel ? canonicalChannelLabel(conversation.channel) : null;
  const checkIn = reservation?.check_in ?? conversation.check_in ?? null;
  const checkOut = reservation?.check_out ?? conversation.check_out ?? null;
  const nights = reservation?.nights ?? nightsBetween(checkIn, checkOut);
  // The detail API returns the raw conversation row (no derived
  // reservation_status, unlike the list API) — derive it here the same way.
  const reservationStatus =
    conversation.reservation_status ??
    deriveReservationStatus(
      conversation.booking_state,
      checkIn,
      checkOut,
      todayInTz(DEFAULT_TIMEZONE).date,
    );
  const stage = stageMeta(reservationStatus);
  const progress = reservationStatus === 'current' ? stayProgress(checkIn, checkOut) : null;

  // Task proposals still awaiting a decision (dismissed/accepted ones drop out).
  const pendingProposals = proposedTasks.filter(
    (pt) => (pt.status ?? 'pending') === 'pending',
  );
  // The tasks section shows when there's a reservation (associated tasks) or any
  // pending proposal to review. Without a reservation, "Associated" is N/A, so
  // there's no toggle — just the proposed list.
  const showTasks = hasReservation || pendingProposals.length > 0;
  const effectiveView: 'associated' | 'proposed' = hasReservation ? taskView : 'proposed';

  return (
    <div className="flex h-full flex-col overflow-y-auto overlay-scrollbar">
      {/* Reservation details */}
      <div className="msg-divider border-b px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-medium text-muted-foreground">Reservation</h2>
          {stage ? (
            <span
              className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${stage.className}`}
            >
              {stage.label}
            </span>
          ) : null}
        </div>

        {isInquiry ? (
          <div className="space-y-3">
            <Field label="Guest" value={guestName} />
            <Field label="Property" value={propertyName ?? '—'} />
            {conversation.check_in || conversation.check_out ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Check-in" value={fmtDate(conversation.check_in)} />
                <Field label="Check-out" value={fmtDate(conversation.check_out)} />
              </div>
            ) : null}
            <div className="msg-well rounded-lg px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {conversation.check_in || conversation.check_out
                ? 'Inquiry — requested dates, not booked yet'
                : 'Inquiry — no booking yet'}
            </div>
          </div>
        ) : hasReservation && loading && !reservation ? (
          <DetailSkeleton />
        ) : (
          <div className="space-y-3">
            <div className="msg-well rounded-xl p-3">
              <div className="text-sm font-semibold text-foreground">
                {propertyName ?? '—'}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{guestName}</div>
              <div className="mt-2.5 flex items-center gap-2 text-sm text-foreground">
                <span className="tabular-nums">{fmtDate(checkIn)}</span>
                <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="tabular-nums">{fmtDate(checkOut)}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{nights != null ? `${nights} night${nights === 1 ? '' : 's'}` : '—'}</span>
                {channel ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{channel}</span>
                  </>
                ) : null}
              </div>
              {progress !== null ? (
                <div className="mt-2.5">
                  <div
                    role="progressbar"
                    aria-label="Stay progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    className="h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--accent-3)] transition-[width] duration-500 dark:bg-[var(--accent-1)]"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            {isCancelled ? (
              <div className="msg-well rounded-lg px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                Reservation cancelled
              </div>
            ) : !hasReservation ? (
              <div className="msg-well rounded-lg px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                Booked — syncing full reservation details
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Tasks — associated (created) tasks within the turnover window, with a
          toggle to review this conversation's pending task proposals. Both
          render as the same card; proposals add inline accept/dismiss. */}
      {showTasks ? (
        <div className="px-4 py-4">
          <h2 className="mb-2 text-[11px] font-medium text-muted-foreground">Tasks</h2>
          {hasReservation ? (
            <div className="mb-3 msg-well flex gap-0.5 rounded-lg p-0.5">
              {(
                [
                  { key: 'associated', label: 'Associated', count: windowedTasks.length },
                  { key: 'proposed', label: 'Proposed', count: pendingProposals.length },
                ] as const
              ).map((seg) => {
                const active = effectiveView === seg.key;
                return (
                  <button
                    key={seg.key}
                    type="button"
                    onClick={() => setTaskView(seg.key)}
                    aria-pressed={active}
                    className={`inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-[var(--accent-3)] text-white shadow-sm'
                        : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    {seg.label}
                    {seg.count > 0 ? (
                      <span
                        className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                          active
                            ? 'bg-white/25 text-white'
                            : 'bg-black/[0.06] text-muted-foreground dark:bg-white/[0.1]'
                        }`}
                      >
                        {seg.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {effectiveView === 'associated' ? (
            loading && tasks.length === 0 ? (
              <DetailSkeleton rows={2} />
            ) : windowedTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No associated tasks</p>
            ) : (
              <div className="space-y-2">
                {windowedTasks.map((t) => (
                  <button
                    key={t.task_id}
                    type="button"
                    onClick={() => onOpenTask?.(t)}
                    title="Open task"
                    className="block w-full rounded-[0.5625rem] text-left transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] dark:focus-visible:ring-[var(--accent-ring-dark)]"
                  >
                    <ProjectCard item={reservationTaskToCardItem(t)} viewMode="status" />
                  </button>
                ))}
              </div>
            )
          ) : pendingProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No proposed tasks</p>
          ) : (
            <div className="space-y-3">
              {pendingProposals.map((pt) => (
                <ProposedTask
                  key={pt.id}
                  proposal={pt}
                  propertyName={propertyName}
                  variant="bare"
                  onOpenEditor={() => onOpenProposal?.(pt)}
                  onChanged={onProposedTaskChange}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DetailSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <span className="block h-2.5 w-16 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
          <span className="block h-3.5 w-28 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
        </div>
      ))}
    </div>
  );
}
