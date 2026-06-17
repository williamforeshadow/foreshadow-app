'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, GraduationCap, SlidersHorizontal, Wrench, Zap } from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { Badge } from '@/components/ui/badge';
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
  { level: 1, name: 'Urgent only', blurb: 'Only when the guest has a time-sensitive problem or question that needs a prompt answer.' },
  { level: 2, name: 'Questions & issues', blurb: 'Also any genuine question, problem, or feedback that wants a response — urgent or not.' },
  { level: 3, name: 'Anything substantive', blurb: 'Also comments, plans, and requests that merit a reply. Skips pure “thanks”-style acknowledgments. (Default)' },
  { level: 4, name: 'Every message', blurb: 'Draft a reply to every inbound message, including simple acknowledgments.' },
];

// Task-proposal sensitivity (1-5).
const TASK_SENSITIVITY_LEVELS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: 'Critical only', blurb: 'Only urgent or safety issues, or anything making the space unusable.' },
  { level: 2, name: 'Clear operational work', blurb: 'Repairs, maintenance, supplies, and explicit “please do X” requests. (Default)' },
  { level: 3, name: 'Operational + administrative', blurb: 'Also booking/stay changes, special arrangements, and follow-ups that need an action — not just an answer.' },
  { level: 4, name: 'Proactive', blurb: 'Most actionable requests, plus notable feedback or preferences that likely need follow-up.' },
  { level: 5, name: 'Track everything', blurb: 'Almost any feedback, request, or issue worth tracking — skip only pure pleasantries.' },
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
    <div className="flex w-full flex-col gap-6 p-6 sm:px-8">
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
        blurb="What the concierge does on its own when a new guest message arrives. Turning one off never blocks the manual path — you can still draft or capture by hand."
      >
        {CAPABILITY_ORDER.map((cap) => (
          <ToggleRow
            key={cap}
            title={CAPABILITY_COPY[cap].title}
            on={CAPABILITY_COPY[cap].on}
            off={CAPABILITY_COPY[cap].off}
            enabled={state ? state.flags[cap] : null}
            saving={savingKey === `cap:${cap}`}
            onChange={(next) => setCapability(cap, next)}
          />
        ))}
      </Section>

      {/* Sensitivity dials */}
      <Section
        icon={<SlidersHorizontal className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />}
        title="Sensitivity"
        blurb="How eager the concierge is — how readily it drafts a reply, and how much it turns into a task."
      >
        <SensitivityRow
          title="Reply sensitivity"
          subtitle="How readily the concierge drafts a reply to an inbound message. Autonomous drafts only — you can always draft manually."
          levels={REPLY_SENSITIVITY_LEVELS}
          value={state?.replySensitivity ?? null}
          saving={savingKey === 'reply-sensitivity'}
          onChange={setReplySensitivity}
        />
        <SensitivityRow
          title="Task proposal sensitivity"
          subtitle="How eager the concierge is to draft a task from a guest message. Applies everywhere; task rules add specifics on top."
          levels={TASK_SENSITIVITY_LEVELS}
          value={state?.taskSensitivity ?? null}
          saving={savingKey === 'task-sensitivity'}
          onChange={setTaskSensitivity}
        />
      </Section>

      {/* Tools */}
      <Section
        icon={<Wrench className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />}
        title="Tools"
        blurb="The read-only abilities the concierge can reach for while drafting a guest reply. Turn one off and the concierge simply won’t use it."
      >
        {TOOL_ORDER.map((tool) => (
          <ToggleRow
            key={tool}
            title={TOOL_COPY[tool].title}
            on={TOOL_COPY[tool].on}
            off={TOOL_COPY[tool].off}
            enabled={state ? state.tools[tool] : null}
            saving={savingKey === `tool:${tool}`}
            onChange={(next) => setTool(tool, next)}
          />
        ))}
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
      <div className="glass-bg-neutral flex h-full p-2.5">
        <div className="msg-pane flex min-w-0 flex-1 flex-col overflow-hidden">
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
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{blurb}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

// One on/off row. `enabled` is null while settings are still loading.
function ToggleRow({
  title,
  on,
  off,
  enabled,
  saving,
  onChange,
}: {
  title: string;
  on: string;
  off: string;
  enabled: boolean | null;
  saving: boolean;
  onChange: (next: boolean) => void;
}) {
  const isOn = enabled !== false; // treat the loading/unknown state as on
  return (
    <div className="msg-well flex items-start justify-between gap-4 rounded-xl p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <Badge
            variant={enabled === false ? 'outline' : 'secondary'}
            className={cn('text-[10px]', enabled === false && 'text-muted-foreground')}
          >
            {enabled === null ? '…' : enabled ? 'On' : 'Off'}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {enabled === null ? 'Loading…' : isOn ? on : off}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled === true}
        aria-label={`${title}: ${isOn ? 'on' : 'off'}`}
        disabled={enabled === null || saving}
        onClick={() => onChange(!isOn)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          isOn ? 'bg-[var(--accent-3)]' : 'bg-black/[0.15] dark:bg-white/[0.18]',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            isOn ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

// Segmented 1..N sensitivity dial. `value` is null while loading.
function SensitivityRow({
  title,
  subtitle,
  levels,
  value,
  saving,
  onChange,
}: {
  title: string;
  subtitle: string;
  levels: { level: number; name: string; blurb: string }[];
  value: number | null;
  saving: boolean;
  onChange: (next: number) => void;
}) {
  const current = useMemo(() => levels.find((l) => l.level === value), [levels, value]);
  return (
    <div className="msg-well space-y-3 rounded-xl p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex items-center gap-2">
        <div className="inline-flex gap-1 rounded-lg bg-black/[0.05] p-1 dark:bg-white/[0.06]">
          {levels.map((l) => {
            const active = value === l.level;
            return (
              <button
                key={l.level}
                type="button"
                onClick={() => onChange(l.level)}
                disabled={saving || value === null}
                aria-pressed={active}
                className={cn(
                  'h-8 w-9 rounded-md text-sm font-semibold transition-colors duration-150 disabled:opacity-50',
                  active
                    ? 'bg-[var(--accent-3)] text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]',
                )}
              >
                {l.level}
              </button>
            );
          })}
        </div>
        {current ? (
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">{current.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">· {current.blurb}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground/80">
          What the levels mean
        </summary>
        <ul className="mt-2 space-y-1">
          {levels.map((l) => (
            <li key={l.level}>
              <span className="font-medium text-foreground">{l.level} · {l.name}</span> — {l.blurb}
            </li>
          ))}
        </ul>
        <p className="mt-2 italic">Levels are cumulative — each includes everything below it.</p>
      </details>
    </div>
  );
}
