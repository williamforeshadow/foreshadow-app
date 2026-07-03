import type { BookingState, CanonicalChannel } from '@/lib/conversations';
import { canonicalChannelKey } from '@/lib/bookingChannel';
import type { PmsMapper } from './types';

// Hospitable -> canonical mappings.
//
// Status strings below are best-effort from the docs; confirm/extend against
// real reservation payloads once org 2's integration is live. Unknown values
// fall back to 'inquiry' (safe — surfaces in the inquiry filter rather than
// masquerading as a confirmed booking).

function mapBookingState(raw: string | null | undefined): BookingState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'accepted' || s === 'confirmed' || s === 'booked') return 'booked';
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'declined' ||
    s === 'not_possible' ||
    s === 'expired'
  ) {
    return 'cancelled';
  }
  if (s === 'request' || s === 'inquiry' || s === 'pending' || s.startsWith('inquiry')) {
    return 'inquiry';
  }
  return 'inquiry';
}

function mapChannel(raw: string | null | undefined): CanonicalChannel {
  return canonicalChannelKey(raw);
}

export const hospitableMapper: PmsMapper = {
  source: 'hospitable',
  mapBookingState,
  mapChannel,
};
