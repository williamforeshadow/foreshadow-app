import type { BookingState, CanonicalChannel } from '@/lib/conversations';
import { canonicalChannelKey } from '@/lib/bookingChannel';
import type { PmsMapper } from './types';

// Hostaway -> canonical mappings.

// Hostaway reservation statuses -> canonical booking_state.
function mapBookingState(raw: string | null | undefined): BookingState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'new' || s === 'modified' || s === 'confirmed' || s === 'ownerstay') {
    return 'booked';
  }
  if (s.startsWith('inquiry')) return 'inquiry';
  if (s === 'cancelled' || s === 'declined' || s === 'expired') return 'cancelled';
  // Unknown/empty -> inquiry (safe: surfaces in the inquiry filter rather than
  // masquerading as a booking).
  return 'inquiry';
}

function mapChannel(raw: string | null | undefined): CanonicalChannel {
  return canonicalChannelKey(raw);
}

export const hostawayMapper: PmsMapper = {
  source: 'hostaway',
  mapBookingState,
  mapChannel,
};
