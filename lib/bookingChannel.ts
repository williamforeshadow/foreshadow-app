// Map PMS channel values to canonical keys + friendly display labels for the UI.
// Unknown values are title-cased as a reasonable fallback.

import type { CanonicalChannel } from '@/lib/conversations';

// Normalized raw key -> canonical channel.
const CANONICAL_BY_KEY: Record<string, CanonicalChannel> = {
  airbnb: 'airbnb',
  airbnbofficial: 'airbnb',
  homeaway: 'vrbo',
  homeawayapiv2: 'vrbo',
  vrbo: 'vrbo',
  bookingcom: 'bookingcom',
  expedia: 'expedia',
  direct: 'direct',
  manual: 'manual',
};

// Friendly labels for canonical channel keys (used by filter chips + UI).
const CANONICAL_LABELS: Record<CanonicalChannel, string> = {
  airbnb: 'Airbnb',
  vrbo: 'VRBO',
  bookingcom: 'Booking.com',
  expedia: 'Expedia',
  direct: 'Direct',
  manual: 'Manual',
  other: 'Other',
};

/** Normalize a raw PMS channel string to a canonical channel key. */
export function canonicalChannelKey(
  raw: string | null | undefined,
): CanonicalChannel {
  if (!raw) return 'other';
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return CANONICAL_BY_KEY[key] ?? 'other';
}

/** Friendly label for a canonical channel key. */
export function canonicalChannelLabel(channel: string | null | undefined): string {
  if (!channel) return 'Other';
  return CANONICAL_LABELS[channel as CanonicalChannel] ?? 'Other';
}

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  airbnbofficial: 'Airbnb',
  bookingcom: 'Booking.com',
  homeaway: 'VRBO',
  homeawayapiv2: 'VRBO',
  vrbo: 'VRBO',
  expedia: 'Expedia',
  marriott: 'Marriott',
  direct: 'Direct',
  partner: 'Partner',
  manual: 'Manual',
};

export function channelLabel(channel: string | null | undefined): string | null {
  if (!channel) return null;
  const key = channel.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  // Fallback: title-case the raw value (e.g. "someChannel" -> "Some Channel").
  return channel
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
