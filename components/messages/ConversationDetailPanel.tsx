'use client';

import { MoveRight } from 'lucide-react';
import { canonicalChannelLabel } from '@/lib/bookingChannel';
import { stageMeta } from '@/components/messages/stage';
import { deriveReservationStatus, type ConversationRow } from '@/lib/conversations';
import { todayInTz, DEFAULT_TIMEZONE } from '@/src/lib/dates';
import { useReservationContext } from '@/components/messages/useReservationContext';

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

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
  contingent: 'Contingent',
};

// Status dot colors — green=done, violet=active, amber=paused/contingent, muted=idle.
const STATUS_DOT: Record<string, string> = {
  not_started: 'bg-muted-foreground/50',
  in_progress: 'bg-[var(--accent-3)]',
  paused: 'bg-amber-500',
  complete: 'bg-emerald-500',
  contingent: 'bg-amber-500',
};

export function ConversationDetailPanel({
  conversation,
}: {
  conversation: ConversationRow | undefined;
}) {
  const reservationId = conversation?.reservation_id ?? null;
  const { reservation, tasks, loading } = useReservationContext(reservationId);

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

      {/* Associated tasks — only once a reservation row is linked. */}
      {hasReservation ? (
        <div className="px-4 py-4">
          <h2 className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            Associated tasks
            {tasks.length > 0 ? (
              <span className="rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground dark:bg-white/[0.08]">
                {tasks.length}
              </span>
            ) : null}
          </h2>

          {loading && tasks.length === 0 ? (
            <DetailSkeleton rows={2} />
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No associated tasks</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.task_id} className="msg-well rounded-xl px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        STATUS_DOT[t.status] ?? 'bg-muted-foreground/50'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {t.title || t.template_name || 'Task'}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{STATUS_LABELS[t.status] ?? t.status}</span>
                        {t.scheduled_date ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{fmtDate(t.scheduled_date)}</span>
                          </>
                        ) : null}
                        {t.department_name ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{t.department_name}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
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
