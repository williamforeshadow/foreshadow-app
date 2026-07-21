'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { GraduationCap, ArrowUpRight, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  toolLabel,
  toolSummaryLine,
  type ConciergeSource,
  type ConciergeSourcesRecord,
} from '@/lib/conciergeSources';

/**
 * "Referenced Training Blocks" — what the Concierge drew on to write this draft,
 * opened from the proposal bubble's header.
 *
 * One flat list, deliberately: always-in-context training blocks first (they
 * govern every reply), then any situational block the model loaded for this
 * message, then the tools it used. Order carries the meaning, so there's no
 * section chrome and no per-row label.
 *
 * Every row is a link that opens in a NEW TAB — the point is to jump to the
 * thing you'd go edit without losing your place in the inbox thread:
 *   - a training block → its editor on the concierge-training page (?rule=<id>)
 *   - a tool           → the concierge settings where that tool is toggled
 *
 * Titles only for blocks: the rule text lives on the training page and a copy
 * here would drift the moment a rule is edited. Renders nothing when `sources`
 * is null (a draft written before sources were recorded) — an empty popup would
 * assert the Concierge used nothing.
 */

const TRAINING_HREF = (ruleId: string) =>
  `/messages/concierge-training?rule=${encodeURIComponent(ruleId)}`;
// The tools all live under one section on the settings page; #tools lands there.
const SETTINGS_TOOLS_HREF = '/messages/concierge-training/settings#tools';

export function TrainingReferences({ sources }: { sources: ConciergeSourcesRecord | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // In the native shell, target="_blank" hands the URL to Safari — jarring, and
  // it drops the operator out of the app. There we navigate in-app instead
  // (both destinations have a MobileRouteShell with a back button). On the web,
  // a new tab is the point: it keeps the operator's place in the thread. The
  // platform never changes, so read it once; the window guard keeps SSR false,
  // which is moot anyway since these rows only render once the dialog is open.
  const [native] = useState(
    () => typeof window !== 'undefined' && !!Capacitor?.isNativePlatform?.(),
  );

  if (!sources || !Array.isArray(sources.sources)) return null;

  const rows = toRows(sources.sources);

  // Native: navigate within the webview and close the popup behind us.
  const openInApp = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--msg-sent-border)] px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
      >
        <GraduationCap className="h-3.5 w-3.5" aria-hidden />
        Referenced Training Blocks
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
              <GraduationCap className="h-4 w-4 text-[var(--accent-3)]" />
              Referenced Training Blocks
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {rows.length === 0 ? (
              <div className="flex items-start gap-2.5 px-2 py-2 text-sm text-muted-foreground">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 opacity-60" aria-hidden />
                <p>
                  No training or property lookups grounded this draft — it was written from the
                  conversation alone.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col">
                {rows.map((r) => {
                  const inner = (
                    <>
                      <div className="min-w-0">
                        <p
                          className={`text-sm leading-snug ${
                            r.failed ? 'text-muted-foreground line-through' : 'text-foreground'
                          }`}
                        >
                          {r.title}
                        </p>
                        {r.caption ? (
                          <p className="text-xs leading-snug text-muted-foreground">{r.caption}</p>
                        ) : null}
                      </div>
                      {/* On native the row navigates in-app (no new "tab" to hint at). */}
                      {native ? null : (
                        <ArrowUpRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </>
                  );
                  const rowClass =
                    'group flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04]';
                  return (
                    <li key={r.key}>
                      {native ? (
                        <button type="button" onClick={() => openInApp(r.href)} className={rowClass}>
                          {inner}
                        </button>
                      ) : (
                        <a
                          href={r.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={rowClass}
                        >
                          {inner}
                        </a>
                      )}
                    </li>
                  );
                })}
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
  href: string;
  /** Tool rows only — what the lookup did. Blocks show no caption. */
  caption?: string;
  /** A failed tool call — shown muted/struck, still links to its settings toggle. */
  failed?: boolean;
}

/**
 * Flatten the stored record into display rows, in the order that carries the
 * meaning: standing training, then situational training, then tools. The
 * always-tier source stores its rules as one aggregate entry, so it expands into
 * one row per block here. Blocks link to their editor; tools to their settings
 * toggle.
 */
function toRows(sources: ConciergeSource[]): Row[] {
  const always: Row[] = [];
  const procedures: Row[] = [];
  const tools: Row[] = [];

  for (const s of sources) {
    if (s.kind === 'training_always') {
      for (const rule of s.rules) {
        always.push({ key: `always:${rule.id}`, title: rule.title, href: TRAINING_HREF(rule.id) });
      }
      continue;
    }
    if (s.kind === 'procedure') {
      procedures.push({ key: `procedure:${s.id}`, title: s.title, href: TRAINING_HREF(s.id) });
      continue;
    }
    tools.push({
      key: `tool:${s.name}`,
      title: s.calls > 1 ? `${toolLabel(s.name)} ×${s.calls}` : toolLabel(s.name),
      caption: toolSummaryLine(s),
      href: SETTINGS_TOOLS_HREF,
      failed: !s.ok,
    });
  }

  return [...always, ...procedures, ...tools];
}
