import {
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  type LucideIcon,
} from 'lucide-react';

// Priority → signal-meter icon for kanban task cards. Bars increase with
// urgency: low (1) → medium (2) → high (3) → urgent (4 / full).
export const PRIORITY_ICONS: Record<string, LucideIcon> = {
  low: SignalLow,
  medium: SignalMedium,
  high: SignalHigh,
  urgent: Signal,
};

// Human label for the icon's title/aria-label — removing the text badge
// otherwise leaves the priority with no accessible name.
export const PRIORITY_TITLE: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};
