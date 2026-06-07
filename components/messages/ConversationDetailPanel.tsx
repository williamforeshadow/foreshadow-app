'use client';

import { canonicalChannelLabel } from '@/lib/bookingChannel';
import type { ConversationRow } from '@/lib/conversations';
import { useReservationContext } from '@/components/messages/useReservationContext';

// Right-hand context panel for the open conversation: reservation details on top,
// then associated tasks. For inquiry threads (no booked reservation) it shows the
// guest + property from the conversation and a "no booking yet" note.

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  // d is YYYY-MM-DD; format without timezone shifting.
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${day}, ${y}`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
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

  const isInquiry = !reservationId;
  const guestName =
    reservation?.guest_name ?? conversation.guest_name ?? 'Guest';
  const propertyName =
    reservation?.property_name ?? conversation.property_name ?? null;
  const channel = conversation.channel ? canonicalChannelLabel(conversation.channel) : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--surface-elevated)]">
      {/* Reservation details */}
      <div className="border-b border-[var(--surface-elevated-divider)] px-4 py-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Reservation
        </h2>

        {isInquiry ? (
          <div className="space-y-3">
            <Field label="Guest" value={guestName} />
            <Field label="Property" value={propertyName ?? '—'} />
            <div className="rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground">
              Inquiry — no booking yet
            </div>
          </div>
        ) : loading && !reservation ? (
          <DetailSkeleton />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Guest" value={guestName} />
            </div>
            <div className="col-span-2">
              <Field label="Property" value={propertyName ?? '—'} />
            </div>
            <Field label="Check-in" value={fmtDate(reservation?.check_in)} />
            <Field label="Check-out" value={fmtDate(reservation?.check_out)} />
            <Field
              label="Nights"
              value={reservation?.nights != null ? reservation.nights : '—'}
            />
            <Field label="Channel" value={channel ?? '—'} />
          </div>
        )}
      </div>

      {/* Associated tasks */}
      {!isInquiry ? (
        <div className="px-4 py-4">
          <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Associated tasks
            {tasks.length > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
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
                <div
                  key={t.task_id}
                  className="rounded-lg border border-[var(--surface-elevated-line)] bg-card px-3 py-2.5"
                >
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
          <span className="block h-2.5 w-16 animate-pulse rounded bg-accent" />
          <span className="block h-3.5 w-28 animate-pulse rounded bg-accent" />
        </div>
      ))}
    </div>
  );
}
