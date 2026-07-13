'use client';

import { useEffect, useState } from 'react';

// Full task shape from /api/reservations/[id]/with-window-tasks. Kept as a
// structural superset of OverlayTaskInput (PropertyTaskDetailOverlay) so an
// associated task can be handed straight to the standard task detail panel —
// same as clicking a task anywhere else in the app. The card only reads a
// subset; the overlay needs the rest.
export interface ReservationContextTask {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string | null;
  description: unknown;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: Record<string, unknown> | null;
  bin_id: string | null;
  bin_name: string | null;
  is_binned: boolean;
  created_at: string;
  updated_at: string;
  assigned_users: {
    user_id: string;
    name: string;
    avatar: string | null;
    role?: string;
  }[];
}

export interface ReservationContext {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_count: number | null;
  check_in: string | null;
  check_out: string | null;
  /** The next reservation's check-in — the turnover window's upper bound
   *  (null when there's no next booking → open-ended window). */
  next_check_in: string | null;
  property_name: string | null;
  channel: string | null;
  nights: number | null;
}

/**
 * Fetch a reservation + its associated turnover tasks for the conversation
 * detail panel. Reuses /api/reservations/[id]/with-window-tasks. No-ops (returns
 * nulls) when reservationId is null — i.e. inquiry threads with no booking.
 */
export function useReservationContext(
  reservationId: string | null,
  // Bump to force a re-fetch (e.g. after editing a task in the detail panel so
  // its card reflects the change).
  refreshKey = 0,
) {
  const [reservation, setReservation] = useState<ReservationContext | null>(null);
  const [tasks, setTasks] = useState<ReservationContextTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!reservationId) {
      setReservation(null);
      setTasks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/reservations/${reservationId}/with-window-tasks`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setReservation(data.reservation ?? null);
        setTasks(data.tasks ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reservationId, refreshKey]);

  return { reservation, tasks, loading };
}
