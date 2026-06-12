import type { ReservationStatus } from '@/lib/conversations';

/**
 * Visual treatment for a conversation's reservation stage. Display-only — the
 * status itself is derived server-side (ConversationRow.reservation_status).
 * Violet is reserved for "current" (the live stay) per the One Signal Rule;
 * every other stage stays neutral.
 */
export function stageMeta(status: ReservationStatus | null | undefined): {
  label: string;
  className: string;
} | null {
  switch (status) {
    case 'current':
      return {
        label: 'Current stay',
        className:
          'bg-[var(--accent-bg-soft)] text-[var(--accent-3)] dark:bg-[var(--accent-bg-soft-dark)] dark:text-[var(--accent-1)]',
      };
    case 'upcoming':
      return {
        label: 'Upcoming',
        className: 'msg-well text-muted-foreground',
      };
    case 'inquiry':
      return {
        label: 'Inquiry',
        className: 'msg-well text-muted-foreground',
      };
    case 'past':
      return {
        label: 'Past',
        className: 'msg-well text-muted-foreground',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        className: 'msg-well text-muted-foreground line-through decoration-muted-foreground/50',
      };
    default:
      // Real rows can carry states outside the typed union (or none at all);
      // a missing chip beats a crashed panel.
      return null;
  }
}
