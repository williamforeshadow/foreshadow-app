'use client';

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, GraduationCap, SlidersHorizontal, Wrench, Zap } from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/utils';

// Concierge Settings — the single home for "how the concierge behaves" config.
// Houses the autonomous-proposal master switches, the two sensitivity dials, and
// the per-tool master switches. All persist to the operations_settings singleton
// via PATCH /api/operations-settings; the training rules themselves live on the
// parent /messages/concierge-training page.

type CapabilityKey = 'reply' | 'task' | 'knowledge';

const CAPABILITY_ORDER: CapabilityKey[] = ['reply', 'task', 'knowledge'];

const CAPABILITY_FLAG_FIELD: Record<CapabilityKey, string> = {
  reply: 'reply_proposal_enabled',
  task: 'task_proposal_enabled',
  knowledge: 'knowledge_proposal_enabled',
};

const CAPABILITY_COPY: Record<CapabilityKey, { title: string; on: string; off: string }> = {
  reply: {
    title: 'Autonomous reply drafting',
    on: 'The concierge drafts a reply to each new guest message so it’s waiting in the inbox.',
    off: 'The concierge won’t auto-draft replies. You can still draft manually in the inbox.',
  },
  task: {
    title: 'Autonomous task proposing',
    on: 'The concierge proposes operational tasks from guest messages for you to review.',
    off: 'The concierge won’t propose tasks from guest messages.',
  },
  knowledge: {
    title: 'Autonomous knowledge capture',
    on: 'The concierge proposes durable property facts worth saving when a conversation reveals one.',
    off: 'The concierge won’t propose new property knowledge to save.',
  },
};

// Per-tool master switches. Keys must match CONCIERGE_TOOL_NAMES on the server.
type ToolKey =
  | 'get_property_knowledge_for_guest'
  | 'check_property_availability'
  | 'find_available_properties';

const TOOL_ORDER: ToolKey[] = [
  'get_property_knowledge_for_guest',
  'check_property_availability',
  'find_available_properties',
];

const TOOL_COPY: Record<ToolKey, { title: string; on: string; off: string }> = {
  get_property_knowledge_for_guest: {
    title: 'Property knowledge lookup',
    on: 'The concierge can look up guest-shareable property facts (wifi, check-in, parking, amenities) to ground its replies.',
    off: 'The concierge won’t look up saved property facts — it replies only from the conversation and details already in front of it.',
  },
  check_property_availability: {
    title: 'Availability check',
    on: 'The concierge can check whether specific dates are open before answering a guest’s availability question.',
    off: 'The concierge won’t check the calendar, so it avoids confirming whether dates are available.',
  },
  find_available_properties: {
    title: 'Alternative property search',
    on: 'When the asked-for dates don’t work, the concierge can suggest other properties that are free for the guest’s dates.',
    off: 'The concierge won’t offer alternative properties.',
  },
};

// Reply-draft sensitivity (1-4). Mirrors the server ladder in draftReply.ts.
const REPLY_SENSITIVITY_LEVELS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: 'Urgent only', blurb: 'Only a time-sensitive problem or question that needs a prompt answer.' },
  { level: 2, name: 'Questions & issues', blurb: 'Level 1, plus any genuine question, problem, or feedback that wants a response — urgent or not.' },
  { level: 3, name: 'Anything substantive', blurb: 'Levels 1 and 2, plus comments, plans, and requests that merit a reply. Skips pure “thanks”-style acknowledgments. (Default)' },
  { level: 4, name: 'Every message', blurb: 'Every inbound message, including simple acknowledgments.' },
];

// Task-proposal sensitivity (1-5).
const TASK_SENSITIVITY_LEVELS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: 'Critical only', blurb: 'Only urgent or safety issues, or anything making the space unusable.' },
  { level: 2, name: 'Clear operational work', blurb: 'Level 1, plus repairs, maintenance, supplies, and explicit “please do X” requests. (Default)' },
  { level: 3, name: 'Operational + administrative', blurb: 'Levels 1 and 2, plus booking/stay changes, special arrangements, and follow-ups that need an action — not just an answer.' },
  { level: 4, name: 'Proactive', blurb: 'Levels 1–3, plus most actionable requests and notable feedback or preferences that likely need follow-up.' },
  { level: 5, name: 'Track everything', blurb: 'Levels 1–4, plus almost any feedback, request, or issue worth tracking — skip only pure pleasantries.' },
];

function clampLevel(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n >= min && n <= max) return Math.round(n);
  return fallback;
}

interface SettingsState {
  flags: Record<CapabilityKey, boolean>;
  replySensitivity: number;
  taskSensitivity: number;
  tools: Record<ToolKey, boolean>;
}

// Parse the API settings payload into our local shape, defaulting every control
// to "on"/its default when absent (migration pending, old row, etc.).
function parseSettings(s: Record<string, unknown> | undefined | null): SettingsState {
  const toolMap = (s?.concierge_tool_settings ?? {}) as Record<string, unknown>;
  return {
    flags: {
      reply: s?.reply_proposal_enabled !== false,
      task: s?.task_proposal_enabled !== false,
      knowledge: s?.knowledge_proposal_enabled !== false,
    },
    replySensitivity: clampLevel(s?.reply_proposal_sensitivity, 1, 4, 3),
    taskSensitivity: clampLevel(s?.task_proposal_sensitivity, 1, 5, 2),
    tools: {
      get_property_knowledge_for_guest: toolMap.get_property_knowledge_for_guest !== false,
      check_property_availability: toolMap.check_property_availability !== false,
      find_available_properties: toolMap.find_available_properties !== false,
    },
  };
}

export default function ConciergeSettingsPage() {
  const isMobile = useIsMobile();
  const [state, setState] = useState<SettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/operations-settings', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to load settings');
        if (active) setState(parseSettings(data?.settings));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Optimistically apply a local change, PATCH it, and roll back on failure.
  // `key` identifies the control for the saving/disabled state; `apply` mutates
  // local state; `body` is the PATCH payload.
  const patch = useCallback(
    async (key: string, apply: (s: SettingsState) => SettingsState, body: Record<string, unknown>) => {
      let snapshot: SettingsState | null = null;
      setState((prev) => {
        if (!prev) return prev;
        snapshot = prev;
        return apply(prev);
      });
      setSavingKey(key);
      setError(null);
      try {
        const res = await fetch('/api/operations-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save');
        }
      } catch (err) {
        if (snapshot) setState(snapshot);
        setError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setSavingKey(null);
      }
    },
    [],
  );

  const setCapability = (cap: CapabilityKey, next: boolean) =>
    patch(
      `cap:${cap}`,
      (s) => ({ ...s, flags: { ...s.flags, [cap]: next } }),
      { [CAPABILITY_FLAG_FIELD[cap]]: next },
    );

  const setReplySensitivity = (next: number) =>
    patch('reply-sensitivity', (s) => ({ ...s, replySensitivity: next }), {
      reply_proposal_sensitivity: next,
    });

  const setTaskSensitivity = (next: number) =>
    patch('task-sensitivity', (s) => ({ ...s, taskSensitivity: next }), {
      task_proposal_sensitivity: next,
    });

  const setTool = (tool: ToolKey, next: boolean) =>
    patch(
      `tool:${tool}`,
      (s) => ({ ...s, tools: { ...s.tools, [tool]: next } }),
      // Send the full map so the column always reflects the current intent.
      {
        concierge_tool_settings: {
          ...(state?.tools ?? {}),
          [tool]: next,
        },
      },
    );

  const content = (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 sm:px-8">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg-soft)] text-[var(--accent-3)]">
          <GraduationCap className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Concierge Settings</h1>
          <p className="text-sm text-muted-foreground">
            Control what the concierge does on its own and the tools it can use.
          </p>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3 text-sm text-red-700 dark:border-red-400/25 dark:bg-red-400/[0.08] dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Autonomous proposals */}
      <Section
        icon={<Zap className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />}
        title="Autonomous actions"
      >
        <div className="flex flex-col items-start gap-2">
          {CAPABILITY_ORDER.map((cap) => (
            <SelectCard
              key={cap}
              title={CAPABILITY_COPY[cap].title}
              enabled={state ? state.flags[cap] : null}
              saving={savingKey === `cap:${cap}`}
              onChange={(next) => setCapability(cap, next)}
            />
          ))}
        </div>
      </Section>

      {/* Tools */}
      <Section
        icon={<Wrench className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />}
        title="Tools"
        blurb="The read-only abilities the concierge can reach for while drafting a guest reply. Turn one off and the concierge simply won’t use it."
      >
        <div className="grid grid-cols-1 items-stretch gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
          {TOOL_ORDER.map((tool) => {
            const enabled = state ? state.tools[tool] : null;
            const isOn = enabled !== false;
            return (
              <Fragment key={tool}>
                <SelectCard
                  title={TOOL_COPY[tool].title}
                  enabled={enabled}
                  saving={savingKey === `tool:${tool}`}
                  onChange={(next) => setTool(tool, next)}
                />
                <p className="flex items-center pb-2 text-sm leading-relaxed text-muted-foreground sm:pb-0">
                  {enabled === null ? 'Loading…' : isOn ? TOOL_COPY[tool].on : TOOL_COPY[tool].off}
                </p>
              </Fragment>
            );
          })}
        </div>
      </Section>

      {/* Sensitivity dials */}
      <Section
        icon={<SlidersHorizontal className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />}
        title="Sensitivity"
      >
        <SensitivityRow
          title="Reply sensitivity"
          levels={REPLY_SENSITIVITY_LEVELS}
          value={state?.replySensitivity ?? null}
          saving={savingKey === 'reply-sensitivity'}
          onChange={setReplySensitivity}
        />
        <SensitivityRow
          title="Task proposal sensitivity"
          levels={TASK_SENSITIVITY_LEVELS}
          value={state?.taskSensitivity ?? null}
          saving={savingKey === 'task-sensitivity'}
          onChange={setTaskSensitivity}
        />
      </Section>

      {loading && !state && (
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );

  return isMobile ? (
    <MobileRouteShell backHref="/messages/concierge-training" title="Concierge Settings">
      {content}
    </MobileRouteShell>
  ) : (
    <DesktopSidebarShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="msg-divider shrink-0 border-b px-4 py-2.5">
          <Link
            href="/messages/concierge-training"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Concierge Training
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar">{content}</div>
      </div>
    </DesktopSidebarShell>
  );
}

function Section({
  icon,
  title,
  blurb,
  children,
}: {
  icon: ReactNode;
  title: string;
  blurb?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {blurb && <p className="-mt-1 text-xs text-muted-foreground">{blurb}</p>}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

// A selectable (multi-select) capability/tool card: a checkbox + title that
// toggles on click. Content-width so a row of them never spans the full panel.
// `enabled` is null while settings load.
function SelectCard({
  title,
  enabled,
  saving,
  onChange,
}: {
  title: string;
  enabled: boolean | null;
  saving: boolean;
  onChange: (next: boolean) => void;
}) {
  const isOn = enabled !== false; // treat the loading/unknown state as on
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={enabled === true}
      aria-label={title}
      disabled={enabled === null || saving}
      onClick={() => onChange(!isOn)}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-border p-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-3)]/40 disabled:opacity-50',
        isOn
          ? 'bg-[var(--accent-3)]/[0.08] text-foreground'
          : 'text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
          isOn
            ? 'border-[var(--accent-3)] bg-[var(--accent-3)] text-white'
            : 'border-muted-foreground/50',
        )}
      >
        {isOn && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">{title}</span>
    </button>
  );
}

// 1..N sensitivity as a vertical multiple-choice list: each level shows its key,
// name, and description inline. `value` is null while loading.
function SensitivityRow({
  title,
  levels,
  value,
  saving,
  onChange,
}: {
  title: string;
  levels: { level: number; name: string; blurb: string }[];
  value: number | null;
  saving: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="msg-well space-y-3 rounded-xl p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {/* Two columns: the selectable level titles on the left, their descriptions
          aligned to the right (row-synced via one grid, so neither runs full width). */}
      <div className="grid grid-cols-1 items-stretch gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
        {levels.map((l) => {
          const active = value === l.level;
          return (
            <Fragment key={l.level}>
              <button
                type="button"
                onClick={() => onChange(l.level)}
                disabled={saving || value === null}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border border-border p-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-3)]/40 disabled:opacity-50',
                  active
                    ? 'bg-[var(--accent-3)]/[0.08] text-foreground'
                    : 'text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    active ? 'border-[var(--accent-3)]' : 'border-muted-foreground/50',
                  )}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-[var(--accent-3)]" />}
                </span>
                <span className="min-w-0">
                  {l.level} · {l.name}
                </span>
              </button>
              <p className="flex items-center pb-2 text-sm leading-relaxed text-muted-foreground sm:pb-0">
                {l.blurb}
              </p>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
