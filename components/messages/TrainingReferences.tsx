'use client';

import { useState } from 'react';
import { BookOpen, CalendarCheck, Home, Building2, Wrench, Library, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  toolLabel,
  toolSummaryLine,
  type ConciergeSource,
  type ConciergeSourcesRecord,
} from '@/lib/conciergeSources';

/**
 * "Training references" — what the Concierge drew on to write this draft, opened
 * from the proposal bubble's header.
 *
 * One flat list, deliberately: always-in-context training blocks first (they
 * govern every reply), then any situational block the model chose to load for
 * this message, then the tools it called. No section chrome — the order carries
 * the meaning, standing rules before on-demand work.
 *
 * Titles only for training blocks. The rule text lives on the training page, and
 * showing a copy here would drift the moment a rule is edited — the title is
 * enough to know which one to go look at.
 *
 * Renders nothing when `sources` is null: that's a draft written before sources
 * were recorded, and an empty popup would assert the Concierge used nothing.
 */
export function TrainingReferences({ sources }: { sources: ConciergeSourcesRecord | null }) {
  const [open, setOpen] = useState(false);

  if (!sources || !Array.isArray(sources.sources)) return null;

  const rows = toRows(sources.sources);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-normal opacity-80 transition-colors hover:bg-amber-500/15 hover:opacity-100 dark:hover:bg-amber-400/15"
      >
        <Library className="h-3 w-3" aria-hidden />
        Training references
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[min(80svh,560px)] flex-col gap-0 overflow-hidden border-[var(--surface-elevated-line)] bg-[var(--surface-elevated)] p-0 shadow-[var(--glass-shadow)] sm:max-w-lg"
        >
          <div
            className="liquid-glass-surface pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
            aria-hidden
          />
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Library className="h-4 w-4 text-[var(--accent-3)]" />
              Training references
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {rows.length === 0 ? (
              <div className="flex items-start gap-2.5 py-2 text-sm text-muted-foreground">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 opacity-60" aria-hidden />
                <p>
                  No training or property lookups grounded this draft — it was written from the
                  conversation alone.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {rows.map((r) => (
                  <li key={r.key} className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 shrink-0 ${r.failed ? 'text-muted-foreground/50' : 'text-[var(--accent-3)]'}`}
                    >
                      {r.icon}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`text-sm leading-snug ${
                          r.failed ? 'text-muted-foreground line-through' : 'text-foreground'
                        }`}
                      >
                        {r.title}
                      </p>
                      <p className="text-xs leading-snug text-muted-foreground">{r.caption}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface Row {
  key: string;
  title: string;
  caption: string;
  icon: React.ReactNode;
  failed?: boolean;
}

const ICON = 'h-4 w-4';

/**
 * Flatten the stored record into display rows, in the order that carries the
 * meaning: standing training, then situational training, then tools. The
 * always-tier source stores its rules as one aggregate entry, so it expands into
 * one row per block here.
 */
function toRows(sources: ConciergeSource[]): Row[] {
  const always: Row[] = [];
  const procedures: Row[] = [];
  const tools: Row[] = [];

  for (const s of sources) {
    if (s.kind === 'training_always') {
      for (const rule of s.rules) {
        always.push({
          key: `always:${rule.id}`,
          title: rule.title,
          caption: 'Training · always in context',
          icon: <BookOpen className={ICON} aria-hidden />,
        });
      }
      continue;
    }
    if (s.kind === 'procedure') {
      procedures.push({
        key: `procedure:${s.id}`,
        title: s.title,
        caption: 'Training · loaded for this message',
        icon: <BookOpen className={ICON} aria-hidden />,
      });
      continue;
    }
    tools.push({
      key: `tool:${s.name}`,
      title: s.calls > 1 ? `${toolLabel(s.name)} ×${s.calls}` : toolLabel(s.name),
      caption: toolSummaryLine(s),
      icon: toolIcon(s.name),
      failed: !s.ok,
    });
  }

  return [...always, ...procedures, ...tools];
}

function toolIcon(name: string): React.ReactNode {
  switch (name) {
    case 'get_property_knowledge_for_guest':
      return <Home className={ICON} aria-hidden />;
    case 'check_property_availability':
      return <CalendarCheck className={ICON} aria-hidden />;
    case 'find_available_properties':
      return <Building2 className={ICON} aria-hidden />;
    case 'get_concierge_procedure':
      return <BookOpen className={ICON} aria-hidden />;
    default:
      return <Wrench className={ICON} aria-hidden />;
  }
}
