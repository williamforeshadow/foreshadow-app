'use client';

import { channelLabel } from '@/lib/bookingChannel';
import type { GuestConversation } from '@/lib/messages';
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
      <div className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </div>
      <div className="text-sm text-neutral-900 dark:text-neutral-100">{value}</div>
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

export function ConversationDetailPanel({
  conversation,
}: {
  conversation: GuestConversation | undefined;
}) {
  const reservationId = conversation?.reservation_id ?? null;
  const { reservation, tasks, loading } = useReservationContext(reservationId);

  if (!conversation) return null;

  const isInquiry = !reservationId;
  const guestName =
    reservation?.guest_name ?? conversation.guest_name ?? 'Guest';
  const propertyName =
    reservation?.property_name ?? conversation.property_name ?? null;
  const channel = channelLabel(reservation?.channel);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Reservation details */}
      <div className="border-b border-[var(--surface-elevated-divider)] px-4 py-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-white">
          Reservation
        </h2>

        {isInquiry ? (
          <div className="space-y-3">
            <Field label="Guest" value={guestName} />
            <Field label="Property" value={propertyName ?? '—'} />
            <div className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
              Inquiry — no booking yet
            </div>
          </div>
        ) : loading && !reservation ? (
          <div className="text-sm text-neutral-400">Loading</div>
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
          <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-white">
            Associated tasks
            {tasks.length > 0 ? (
              <span className="ml-2 text-xs font-normal text-neutral-400">
                {tasks.length}
              </span>
            ) : null}
          </h2>

          {loading && tasks.length === 0 ? (
            <div className="text-sm text-neutral-400">Loading</div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-neutral-400">No associated tasks</div>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <div
                  key={t.task_id}
                  className="rounded-md border border-[var(--surface-elevated-divider)] px-3 py-2"
                >
                  <div className="text-sm text-neutral-900 dark:text-neutral-100">
                    {t.title || t.template_name || 'Task'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
                    <span>{STATUS_LABELS[t.status] ?? t.status}</span>
                    {t.scheduled_date ? (
                      <>
                        <span>·</span>
                        <span>{fmtDate(t.scheduled_date)}</span>
                      </>
                    ) : null}
                    {t.department_name ? (
                      <>
                        <span>·</span>
                        <span>{t.department_name}</span>
                      </>
                    ) : null}
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
