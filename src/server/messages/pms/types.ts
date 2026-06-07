import type { BookingState, CanonicalChannel } from '@/lib/conversations';

// A per-PMS normalizer: maps that PMS's native reservation status + channel into
// the canonical schema. Adding a PMS later = implement this + register it in
// pms/index.ts. No canonical-layer changes needed.
export interface PmsMapper {
  source: string;
  mapBookingState(rawStatus: string | null | undefined): BookingState;
  mapChannel(rawChannel: string | null | undefined): CanonicalChannel;
}
