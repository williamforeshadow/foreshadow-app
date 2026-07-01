'use client';

import { useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Editable transcript field for a worked example, with Host/Guest quick-insert
// buttons so operators don't have to remember to type the "Host:"/"Guest:" line
// prefixes by hand. Inserts a speaker cue on its own line at the caret. Shared by
// the concierge-training editor (add + edit example) and the promote dialog.

export function ExampleTranscriptField({
  value,
  onChange,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const insertSpeaker = (speaker: 'Host' | 'Guest') => {
    const el = ref.current;
    const caretStart = el?.selectionStart ?? value.length;
    const before = value.slice(0, caretStart);
    const after = value.slice(caretStart);
    // A speaker cue always starts its own line.
    const needsNewline = before.length > 0 && !before.endsWith('\n');
    const inserted = `${needsNewline ? '\n' : ''}${speaker}: `;
    onChange(before + inserted + after);
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      const node = ref.current;
      if (node) {
        node.focus();
        node.setSelectionRange(caret, caret);
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Add line:</span>
        <button
          type="button"
          onClick={() => insertSpeaker('Host')}
          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-3)] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          Host
        </button>
        <button
          type="button"
          onClick={() => insertSpeaker('Guest')}
          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          Guest
        </button>
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={'Host: …\nGuest: …'}
        className={cn(
          'min-h-[7rem] resize-none rounded-xl border-border bg-black/[0.025] font-mono text-xs leading-[1.7] text-foreground dark:bg-white/[0.04]',
          className,
        )}
      />
    </div>
  );
}
