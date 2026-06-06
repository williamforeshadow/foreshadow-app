// Map Hostaway channelName values to friendly display labels for the UI.
// Unknown values are title-cased as a reasonable fallback.

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
