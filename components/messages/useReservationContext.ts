'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';

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
const EMPTY_TASKS: ReservationContextTask[] = [];

export function useReservationContext(
  reservationId: string | null,
  // Bump to force a re-fetch (e.g. after editing a task in the detail panel so
  // its card reflects the change).
  refreshKey = 0,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.reservationWindowTasks(reservationId ?? ''),
    enabled: !!reservationId,
    queryFn: async () => {
      const data = await fetchJson<{
        reservation?: ReservationContext | null;
        tasks?: ReservationContextTask[];
      }>(`/api/reservations/${reservationId}/with-window-tasks`);
      return { reservation: data.reservation ?? null, tasks: data.tasks ?? [] };
    },
  });

  // refreshKey bumps become cache invalidations (skip the initial mount —
  // the query itself owns the first fetch).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (reservationId) {
      queryClient.invalidateQueries({ queryKey: qk.reservationWindowTasks(reservationId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return {
    reservation: query.data?.reservation ?? null,
    tasks: query.data?.tasks ?? EMPTY_TASKS,
    loading: query.isLoading,
  };
}
