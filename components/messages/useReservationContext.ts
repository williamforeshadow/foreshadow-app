'use client';

import { useEffect, useState } from 'react';

export interface ReservationContextTask {
  task_id: string;
  title: string | null;
  template_name: string | null;
  status: string;
  scheduled_date: string | null;
  department_name: string | null;
  assigned_users: { user_id: string; name: string; avatar: string | null }[];
}

export interface ReservationContext {
  id: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  property_name: string | null;
  channel: string | null;
  nights: number | null;
}

/**
 * Fetch a reservation + its associated turnover tasks for the conversation
 * detail panel. Reuses /api/reservations/[id]/with-window-tasks. No-ops (returns
 * nulls) when reservationId is null — i.e. inquiry threads with no booking.
 */
export function useReservationContext(reservationId: string | null) {
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
  }, [reservationId]);

  return { reservation, tasks, loading };
}
