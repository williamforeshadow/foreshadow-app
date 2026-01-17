import type { Turnover } from './types';

/**
 * Get the active turnover for a property from a list of reservations.
 * Active = first non-past reservation (sorted by check_out) where check_in has passed.
 */
export function getActiveTurnoverForProperty(reservations: Turnover[]): Turnover | null {
  if (!reservations.length) return null;
  
  const now = new Date();
  
  // First filter out past turnovers (same logic as TurnoverCards)
  const activeReservations = reservations.filter(item => {
    const checkOut = item.check_out ? new Date(item.check_out) : null;
    const nextCheckIn = item.next_check_in ? new Date(item.next_check_in) : null;
    
    // Keep if checkout is now or future
    if (checkOut && checkOut >= now) return true;
    
    // Keep if next check-in is now or future, or no next booking yet
    if (!nextCheckIn || nextCheckIn >= now) return true;
    
    // Both dates are in the past - this turnover is complete, hide it
    return false;
  });
  
  if (!activeReservations.length) return null;
  
  // Sort by check_out date (chronological)
  const sorted = [...activeReservations].sort((a, b) => {
    const dateA = a.check_out ? new Date(a.check_out).getTime() : 0;
    const dateB = b.check_out ? new Date(b.check_out).getTime() : 0;
    return dateA - dateB;
  });
  
  // First one is active if check_in has passed
  const first = sorted[0];
  const checkIn = first.check_in ? new Date(first.check_in) : null;
  
  if (checkIn && now >= checkIn) {
    return first;
  }
  
  return null;
}

/**
 * Get the CSS background color class for a turnover status.
 */
export function getTurnoverStatusColor(status: string): string {
  switch (status) {
    case 'not_started':
      return 'bg-red-500';
    case 'in_progress':
      return 'bg-yellow-500';
    case 'complete':
      return 'bg-green-500';
    case 'no_tasks':
    default:
      return 'bg-neutral-400';
  }
}
