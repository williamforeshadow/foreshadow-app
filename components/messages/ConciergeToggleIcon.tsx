import { Sparkles, X } from 'lucide-react';

/**
 * Concierge on/off state icon. Active: a plain sparkle (inherits currentColor).
 * Off: a muted sparkle with a small red × badge in the lower-right corner — the
 * concierge is silenced on this thread.
 */
export function ConciergeToggleIcon({
  enabled,
  className = 'h-4 w-4',
}: {
  enabled: boolean;
  className?: string;
}) {
  if (enabled) return <Sparkles className={className} aria-hidden />;
  return (
    <span className="relative inline-flex">
      <Sparkles className={`${className} text-muted-foreground`} aria-hidden />
      <X
        className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-red-500"
        strokeWidth={3.5}
        aria-hidden
      />
    </span>
  );
}
