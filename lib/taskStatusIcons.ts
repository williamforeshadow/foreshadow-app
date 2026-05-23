import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CirclePause,
  type LucideIcon,
} from 'lucide-react';

// Status → icon for kanban task cards. Keyed loosely on string so both
// ProjectStatus and the wider TaskStatus (which includes 'contingent')
// resolve through the same map; callers fall back to not_started.
export const STATUS_ICONS: Record<string, LucideIcon> = {
  not_started: Circle,
  in_progress: CircleDashed,
  paused: CirclePause,
  contingent: CircleDotDashed,
  complete: CircleCheck,
};

// Human label for the icon's title/aria-label — removing the text badge
// otherwise leaves the status with no accessible name.
export const STATUS_TITLE: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  contingent: 'Contingent',
  complete: 'Complete',
};
