'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, MessageCircle, X } from 'lucide-react';
import { canonicalChannelLabel } from '@/lib/bookingChannel';
import { toast } from '@/components/ui/toast';
import { conversationPath } from '@/src/lib/links';
import { ProjectCard, type DraggableProjectItem } from '@/components/windows/projects/ProjectCard';
import { ProposedTask, type ProposedTaskData } from '@/components/messages/ProposedTask';
import { filterTasksInTurnoverWindow } from '@/components/properties/schedule/scheduleDates';
import { useOperationsSettings } from '@/lib/operationsSettingsContext';
import { ReservationContextOverride } from '@/lib/reservationViewerContext';
import type { ConversationRow } from '@/lib/conversations';
import type { ProjectStatus, ProjectPriority, User } from '@/lib/types';
import {
  useReservationContext,
  type ReservationContextTask,
} from '@/components/reservations/useReservationContext';

// Shared reservation context panel — the single reservation detail surface for
// the whole app. Renders the stay at a glance (property, dates + org check-in/
// out times, nights, guest contact, channel, next check-in / turnover gap),
// then the associated tasks as the same ProjectCards used everywhere else.
//
// Four hosts share it:
//   - Messages right rail + mobile top sheet (via ConversationDetailPanel
//     semantics: pass `conversation`; no header — the conversation header
//     above already names the guest). Conversation-only extras (inquiry
//     state, sentiment, proposed-task toggle) render only in this mode.
//   - Turnovers window right pane (pass `reservationId` + `header`).
//   - Property Schedule tab (same).
//   - Global reservation viewer overlay / key-icon (same).
//
// Data comes from useReservationContext → /api/reservations/[id]/with-window-tasks
// (one round-trip: reservation row + tasks in the turnover window). The
// coarse date-range task set is narrowed here to the precise window
// [check_in @ check-in-time, next_check_in @ check-in-time) so every host
// lists identical associated tasks.
//
// The content is wrapped in <ReservationContextOverride>, so any key
// affordance inside renders as a static badge instead of re-opening the
// reservation that's already on screen.

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  // d is YYYY-MM-DD; format without timezone shifting.
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${day}, ${y}`;
}

function daysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}

// 'HH:MM' (24h) → '3:00 PM' for the org check-in/out time display.
function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${ampm}`;
}

// The Properties nav icon from the app sidebar (components/Sidebar.tsx),
// reused so the property reads consistently with the rest of the app.
function PropertyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

// Split a trailing "(...)" off a property name into a sub-label, e.g.
// "5023 Foothill Blvd (ADU)" → { primary: "5023 Foothill Blvd", sub: "ADU" }.
function splitPropertyName(name: string | null): { primary: string; sub: string | null } {
  if (!name) return { primary: '—', sub: null };
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m && m[1].trim()) return { primary: m[1].trim(), sub: m[2].trim() };
  return { primary: name, sub: null };
}

// Visual treatment for the guest-sentiment pill. Positive leans emerald,
// negative red, neutral stays muted (matching the neutral reservation-stage
// chips) — deliberately reusing the app's semantic status palette.
function sentimentMeta(
  sentiment: 'positive' | 'neutral' | 'negative' | null | undefined,
): { label: string; className: string } | null {
  switch (sentiment) {
    case 'positive':
      return {
        label: 'Positive',
        className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      };
    case 'negative':
      return {
        label: 'Negative',
        className: 'bg-red-500/10 text-red-700 dark:text-red-300',
      };
    case 'neutral':
      return { label: 'Neutral', className: 'msg-well text-muted-foreground' };
    default:
      return null;
  }
}

// A labeled cell in the reservation details grid: an uppercase label, a primary
// value, and an optional muted sub-value (e.g. the check-in time under a date).
function GridField({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm text-foreground">{value}</div>
      {sub ? (
        <div className="truncate text-xs tabular-nums text-muted-foreground">{sub}</div>
      ) : null}
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

export interface ReservationContextPanelHeader {
  /** Override the header title; defaults to the fetched guest name. Hosts
   *  that know the stay is an owner stay pass 'Owner Stay' here (the
   *  reservation row itself doesn't ship `kind` through this endpoint). */
  title?: string;
  onClose: () => void;
}

export function ReservationContextPanel({
  reservationId: reservationIdProp,
  conversation,
  header,
  onOpenTask,
  tasksRefreshKey = 0,
  proposedTasks = [],
  onOpenProposal,
  onProposedTaskChange,
}: {
  /** Direct reservation target (Turnovers / Schedule / global viewer). When
   *  omitted, falls back to conversation.reservation_id (messages hosts). */
  reservationId?: string | null;
  /** Messages hosts pass the open conversation to unlock the conversation-only
   *  sections: inquiry/cancelled states, sentiment, and the proposed-tasks
   *  toggle, plus guest/date fallbacks while the reservation link syncs. */
  conversation?: ConversationRow;
  /** Renders a guest-name header with a close button. Hosts whose chrome
   *  already names the guest (messages) omit it. */
  header?: ReservationContextPanelHeader;
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
  const reservationId =
    reservationIdProp ?? conversation?.reservation_id ?? null;
  const { reservation, tasks, loading, error } = useReservationContext(
    reservationId,
    tasksRefreshKey,
  );

  // The endpoint returns a coarse date-range set; narrow it to the precise
  // turnover window [check_in @ check-in-time, next_check_in @ check-in-time)
  // — the same filter the turnovers RPC applies, so every surface lists
  // identical associated tasks. Check-in time is the org-wide default from
  // operations_settings (there's no per-property check-in time).
  const { settings } = useOperationsSettings();
  const defaultCheckInTime = (settings.default_check_in_time || '15:00').slice(0, 5);
  const defaultCheckOutTime = (settings.default_check_out_time || '11:00').slice(0, 5);
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
  // The sentiment summary is collapsed by default (just the label + pill); the
  // operator expands it to read the summary. Reset closed per conversation.
  const [sentimentOpen, setSentimentOpen] = useState(false);
  const [prevKey, setPrevKey] = useState<string | undefined>(
    conversation?.id ?? reservationId ?? undefined,
  );
  const currentKey = conversation?.id ?? reservationId ?? undefined;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setTaskView('associated');
    setSentimentOpen(false);
  }

  if (!conversation && !reservationId) return null;

  // Inquiry vs booked is driven by the conversation's own booking_state, NOT by
  // whether a reservation row is linked — a conversation can be booked before
  // its reservation has synced/linked, in which case we show what we have.
  // Non-conversation hosts always target a concrete reservation, so both
  // flags are simply false there.
  const isInquiry = conversation?.booking_state === 'inquiry';
  const isCancelled = conversation?.booking_state === 'cancelled';
  const hasReservation = !!reservationId;
  const propertyName =
    reservation?.property_name ?? conversation?.property_name ?? null;
  const channelRaw = reservation?.channel ?? conversation?.channel ?? null;
  const channel = channelRaw ? canonicalChannelLabel(channelRaw) : null;
  const checkIn = reservation?.check_in ?? conversation?.check_in ?? null;
  const checkOut = reservation?.check_out ?? conversation?.check_out ?? null;
  const nights = reservation?.nights ?? daysBetween(checkIn, checkOut);
  const { primary: propPrimary, sub: propSub } = splitPropertyName(propertyName);

  // Next check-in → the turnover window's upper bound. Surfaced with the gap
  // between stays so an operator can see turnover pressure at a glance
  // ("Same-day turnover" being the urgent case). Null = no next booking.
  const nextCheckIn = reservation?.next_check_in ?? null;
  const turnoverGap = daysBetween(checkOut, nextCheckIn);

  // Guest contact + party size come from the linked reservation (booked threads
  // only — inquiries have no reservation row). Check-in/out times are org-wide.
  const guestCount = reservation?.guest_count ?? null;
  const guestEmail = reservation?.guest_email ?? null;
  const guestPhone = reservation?.guest_phone ?? null;

  // Task proposals still awaiting a decision (dismissed/accepted ones drop out).
  const pendingProposals = proposedTasks.filter(
    (pt) => (pt.status ?? 'pending') === 'pending',
  );
  // The tasks section shows when there's a reservation (associated tasks) or any
  // pending proposal to review. Without a reservation, "Associated" is N/A, so
  // there's no toggle — just the proposed list. The toggle itself is a
  // conversation-only affordance (proposals belong to a conversation).
  const showTasks = hasReservation || pendingProposals.length > 0;
  const showTaskToggle = !!conversation && hasReservation;
  const effectiveView: 'associated' | 'proposed' = hasReservation ? taskView : 'proposed';

  const sentimentPill = sentimentMeta(conversation?.sentiment);

  const body = (
    <>
      {/* Reservation. In conversation mode there's no section label, status
          pill or guest hero: the conversation header spans this column and
          already names the guest, so the panel opens on the property.
          Standalone hosts get the guest via the `header` prop instead. */}
      <div className="msg-divider border-b">
        {isInquiry && conversation ? (
          <div className="space-y-3 px-4 pb-4 pt-4">
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
        ) : hasReservation && error && !reservation ? (
          <div className="px-4 pb-4 pt-4 text-sm text-red-500">{error}</div>
        ) : hasReservation && loading && !reservation ? (
          <div className="px-4 pb-4 pt-4">
            <DetailSkeleton />
          </div>
        ) : (
          <>
            {/* Property — same house icon as the app sidebar's Properties nav. */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <PropertyIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{propPrimary}</div>
                {propSub ? (
                  <div className="truncate text-xs text-muted-foreground">{propSub}</div>
                ) : null}
              </div>
            </div>

            {/* Stay + guest fields */}
            <div className="msg-divider border-t px-4 py-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <GridField
                  label="Check-in"
                  value={<span className="tabular-nums">{fmtDate(checkIn)}</span>}
                  sub={formatTime12(defaultCheckInTime)}
                />
                <GridField
                  label="Checkout"
                  value={<span className="tabular-nums">{fmtDate(checkOut)}</span>}
                  sub={formatTime12(defaultCheckOutTime)}
                />
                <GridField
                  label="Nights"
                  value={
                    <span className="tabular-nums">{nights != null ? nights : '—'}</span>
                  }
                />
                <GridField
                  label="Phone"
                  value={
                    guestPhone ? (
                      <a
                        href={`tel:${guestPhone}`}
                        className="tabular-nums text-[var(--accent-3)] hover:underline dark:text-[var(--accent-1)]"
                      >
                        {guestPhone}
                      </a>
                    ) : (
                      '—'
                    )
                  }
                />
                <GridField label="Guests" value={guestCount != null ? guestCount : '—'} />
                <GridField label="Channel" value={channel ?? '—'} />
                {nextCheckIn ? (
                  <GridField
                    label="Next check-in"
                    value={<span className="tabular-nums">{fmtDate(nextCheckIn)}</span>}
                    sub={
                      turnoverGap === 0
                        ? 'Same-day turnover'
                        : turnoverGap != null
                          ? `${turnoverGap} day${turnoverGap === 1 ? '' : 's'} between stays`
                          : undefined
                    }
                  />
                ) : null}
              </div>

              {guestEmail ? (
                <div className="mt-4">
                  <GridField
                    label="Email"
                    value={
                      <a
                        href={`mailto:${guestEmail}`}
                        className="text-[var(--accent-3)] hover:underline dark:text-[var(--accent-1)]"
                      >
                        {guestEmail}
                      </a>
                    }
                  />
                </div>
              ) : null}

              {/* Message guest — standalone hosts only (in conversation mode
                  the panel already lives beside the thread). Opens the linked
                  conversation in a NEW browser tab so the operator keeps
                  their current surface; when the reservation has no thread
                  yet, says so in a toast instead. */}
              {!conversation && hasReservation ? (
                <button
                  type="button"
                  onClick={() => {
                    if (reservation?.conversation_id) {
                      window.open(
                        conversationPath(reservation.conversation_id),
                        '_blank',
                        'noopener,noreferrer'
                      );
                    } else {
                      toast.info('No conversation with this guest yet');
                    }
                  }}
                  className="mt-4 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[rgba(30,25,20,0.1)] text-[12px] font-medium text-[var(--accent-3)] transition-colors hover:bg-[var(--accent-bg-soft)] dark:border-white/10 dark:text-[var(--accent-1)] dark:hover:bg-[var(--accent-bg-soft-dark)]"
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  Message guest
                </button>
              ) : null}

              {isCancelled ? (
                <div className="msg-well mt-4 rounded-lg px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  Reservation cancelled
                </div>
              ) : conversation && !hasReservation ? (
                <div className="msg-well mt-4 rounded-lg px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  Booked — syncing full reservation details
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Sentiment — conversation-only: a coarse read of the guest's disposition
          (positive/neutral/negative) as a pill, collapsed by default. When a
          summary exists the row is a disclosure toggle that reveals it.
          Generated eagerly on inbound and read here; null until first generated. */}
      {conversation ? (
        <div className="msg-divider border-b px-4 py-4">
          {conversation.sentiment_summary ? (
            <>
              <button
                type="button"
                onClick={() => setSentimentOpen((o) => !o)}
                aria-expanded={sentimentOpen}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sentiment
                </h2>
                <span className="flex shrink-0 items-center gap-1.5">
                  {sentimentPill ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sentimentPill.className}`}
                    >
                      {sentimentPill.label}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                      sentimentOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden
                  />
                </span>
              </button>
              {sentimentOpen ? (
                <p className="mt-2 text-sm leading-relaxed text-foreground">
                  {conversation.sentiment_summary}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Sentiment
              </h2>
              <span className="shrink-0 text-xs text-muted-foreground">No summary yet</span>
            </div>
          )}
        </div>
      ) : null}

      {/* Tasks — associated (created) tasks within the turnover window, with a
          conversation-only toggle to review pending task proposals. Both
          render as the same card; proposals add inline accept/dismiss. */}
      {showTasks ? (
        <div className="px-4 py-4">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tasks</h2>
          {showTaskToggle ? (
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
    </>
  );

  // Headerless (messages) mode keeps the historical single-scroller root so
  // the mobile top sheet's wrapper-owned scrolling keeps working (the panel's
  // percentage height collapses to content height there by design).
  if (!header) {
    return (
      <ReservationContextOverride id={reservationId}>
        <div className="flex h-full flex-col overflow-y-auto overlay-scrollbar">{body}</div>
      </ReservationContextOverride>
    );
  }

  const title =
    header.title ?? reservation?.guest_name ?? (loading ? '…' : 'Unnamed guest');

  return (
    <ReservationContextOverride id={reservationId}>
      <div className="h-full w-full flex flex-col bg-white dark:bg-background">
        <div className="flex items-start justify-between gap-3 px-4 pt-5 pb-4 border-b border-[rgba(30,25,20,0.06)] dark:border-white/5">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="text-[10px] italic font-medium tracking-[0.08em] uppercase text-neutral-400 dark:text-[#66645f]">
              Reservation
            </div>
            <div className="text-[18px] font-semibold text-neutral-900 dark:text-[#f0efed] truncate">
              {title}
            </div>
          </div>
          <button
            onClick={header.onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-500 dark:text-[#a09e9a]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overlay-scrollbar">{body}</div>
      </div>
    </ReservationContextOverride>
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
