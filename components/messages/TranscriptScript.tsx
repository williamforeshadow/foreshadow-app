import { cn } from '@/lib/utils';

// Screenplay-style rendering of a "Host: …/Guest: …" transcript: uppercase,
// color-coded speaker cues beside monospace dialogue. Shared by the promote
// ("Turn into training") dialog and the concierge-training editor so a worked
// example reads identically wherever it's shown.

interface ScriptLine {
  speaker: 'Host' | 'Guest' | '';
  text: string;
}

// Split the rendered transcript into speaker segments, folding continuation
// lines (a multi-line message body) into the prior speaker.
function parseTranscript(raw: string): ScriptLine[] {
  const segments: ScriptLine[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^(Host|Guest):\s?(.*)$/);
    if (m) {
      segments.push({ speaker: m[1] as 'Host' | 'Guest', text: m[2] });
    } else if (segments.length > 0) {
      segments[segments.length - 1].text += `\n${line}`;
    } else {
      segments.push({ speaker: '', text: line });
    }
  }
  return segments;
}

export function TranscriptScript({
  transcript,
  className,
}: {
  transcript: string;
  className?: string;
}) {
  const segments = parseTranscript(transcript);
  return (
    <div
      className={cn(
        'space-y-2.5 rounded-xl border border-border bg-black/[0.025] p-4 font-mono text-xs leading-[1.6] dark:bg-white/[0.04]',
        className,
      )}
    >
      {segments.length === 0 ? (
        <p className="text-muted-foreground">(empty)</p>
      ) : (
        segments.map((s, i) => (
          <div key={i} className="grid grid-cols-[3.25rem_1fr] gap-x-3">
            <span
              className={cn(
                'select-none text-[10px] font-semibold uppercase tracking-wider',
                s.speaker === 'Host'
                  ? 'text-[var(--accent-3)]'
                  : s.speaker === 'Guest'
                    ? 'text-muted-foreground'
                    : 'text-transparent',
              )}
            >
              {s.speaker}
            </span>
            <span className="whitespace-pre-wrap break-words text-foreground">{s.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
