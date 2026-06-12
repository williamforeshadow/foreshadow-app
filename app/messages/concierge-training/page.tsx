'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  GraduationCap,
  FlaskConical,
  SlidersHorizontal,
} from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { MultiSelect, type FilterOption } from '@/components/tasks/TaskFilterBar';
import { cn } from '@/lib/utils';

// CRUD-backed training lives under two categories; the third tab (property
// knowledge) is on/off only for now and has no rules list.
type TrainingCategory = 'reply' | 'task';
type TrainingTab = TrainingCategory | 'knowledge';

interface TrainingRule {
  id: string;
  title: string;
  instructions: string;
  category: TrainingCategory;
  applies_to_all: boolean;
  is_active: boolean;
  sort_order: number;
  property_ids: string[];
  created_at: string;
  updated_at: string;
}

const CATEGORY_META: Record<
  TrainingCategory,
  { label: string; blurb: string; placeholderTitle: string }
> = {
  reply: {
    label: 'Reply training',
    blurb: 'Procedures the AI follows when drafting guest replies.',
    placeholderTitle: 'Door Lock Troubleshooting',
  },
  task: {
    label: 'Task training',
    blurb: 'When and how the AI should draft operational tasks from guest messages.',
    placeholderTitle: 'Create a maintenance task for AC issues',
  },
};

// Tab chrome for all three sections (the knowledge tab has no CRUD meta).
const TAB_META: Record<TrainingTab, { label: string; blurb: string }> = {
  reply: { label: 'Replies', blurb: CATEGORY_META.reply.blurb },
  task: { label: 'Tasks', blurb: CATEGORY_META.task.blurb },
  knowledge: {
    label: 'Property Knowledge',
    blurb: 'Durable facts about a property the AI saves from conversations to reuse next time.',
  },
};

const TAB_ORDER: TrainingTab[] = ['reply', 'task', 'knowledge'];

// Concierge capability master switches mirror the operations_settings flags.
type CapabilityKey = 'reply' | 'task' | 'knowledge';
interface CapabilityFlags {
  reply: boolean;
  task: boolean;
  knowledge: boolean;
}
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

interface PropertyOption {
  id: string;
  name: string;
}

type EditorState =
  | { mode: 'create'; category: TrainingCategory }
  | { mode: 'edit'; rule: TrainingRule }
  | null;

export default function ConciergeTrainingPage() {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<TrainingTab>('reply');
  const [rules, setRules] = useState<TrainingRule[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<EditorState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Capability master switches (operations_settings). null while loading.
  const [flags, setFlags] = useState<CapabilityFlags | null>(null);
  const [flagSaving, setFlagSaving] = useState<CapabilityKey | null>(null);

  const propertyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, p.name);
    return m;
  }, [properties]);

  // Only reply/task have a rules list; knowledge is on/off only.
  const visibleRules = useMemo(
    () => (activeTab === 'knowledge' ? [] : rules.filter((r) => r.category === activeTab)),
    [rules, activeTab],
  );

  const loadRules = useCallback(async () => {
    const res = await fetch('/api/concierge-training');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to load rules');
    setRules(Array.isArray(data.rules) ? data.rules : []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [, propsRes, settingsRes] = await Promise.all([
          loadRules(),
          fetch('/api/properties').then((r) => r.json()),
          fetch('/api/operations-settings', { cache: 'no-store' }).then((r) => r.json()),
        ]);
        if (!active) return;
        setProperties(
          Array.isArray(propsRes?.properties)
            ? propsRes.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
            : [],
        );
        const s = settingsRes?.settings ?? {};
        setFlags({
          reply: s.reply_proposal_enabled !== false,
          task: s.task_proposal_enabled !== false,
          knowledge: s.knowledge_proposal_enabled !== false,
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadRules]);

  // Flip a capability master switch optimistically; roll back on failure.
  const setCapability = useCallback(
    async (key: CapabilityKey, next: boolean) => {
      setFlags((prev) => (prev ? { ...prev, [key]: next } : prev));
      setFlagSaving(key);
      setError(null);
      try {
        const res = await fetch('/api/operations-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [CAPABILITY_FLAG_FIELD[key]]: next }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save');
        }
      } catch (err) {
        setFlags((prev) => (prev ? { ...prev, [key]: !next } : prev));
        setError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setFlagSaving(null);
      }
    },
    [],
  );

  const handleToggleActive = async (rule: TrainingRule) => {
    setError(null);
    try {
      const res = await fetch(`/api/concierge-training/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update');
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (rule: TrainingRule) => {
    if (!confirm(`Delete "${rule.title}"? This cannot be undone.`)) return;
    setDeletingId(rule.id);
    setError(null);
    try {
      const res = await fetch(`/api/concierge-training/${rule.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete');
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const trainingPanel = (
    <>
      <CategoryTabs active={activeTab} onChange={setActiveTab} />
      <p className="-mt-1 text-xs text-muted-foreground">{TAB_META[activeTab].blurb}</p>

      <CapabilityToggle
        capability={activeTab}
        enabled={flags ? flags[activeTab] : null}
        saving={flagSaving === activeTab}
        onChange={(next) => setCapability(activeTab, next)}
      />

      {activeTab === 'knowledge' ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          <p>
            When a guest conversation reveals a lasting fact about a property — a quirk, an access
            detail, a recurring service — the concierge can propose saving it to that property’s
            knowledge so it informs future replies. Use the switch above to turn that on or off.
          </p>
          <p className="mt-2 text-xs">
            Property-specific knowledge training (rules guiding what to save) is coming later.
          </p>
        </div>
      ) : (
      <>
      {activeTab === 'reply' ? <ReplySensitivityControl /> : null}
      {activeTab === 'task' ? <SensitivityControl /> : null}

      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-xs">
          {visibleRules.length} {visibleRules.length === 1 ? 'entry' : 'entries'}
        </Badge>
        <Button onClick={() => setEditor({ mode: 'create', category: activeTab })}>
          <Plus className="mr-2 h-4 w-4" />
          New training
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visibleRules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            No {CATEGORY_META[activeTab].label.toLowerCase()} yet. Add your first procedure — e.g.
            “{CATEGORY_META[activeTab].placeholderTitle}”.
          </p>
          <Button onClick={() => setEditor({ mode: 'create', category: activeTab })}>
            <Plus className="mr-2 h-4 w-4" />
            Create your first
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleRules.map((rule) => (
            <Card key={rule.id} className={cn('group', !rule.is_active && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-foreground">{rule.title}</h3>
                      {rule.applies_to_all ? (
                        <Badge variant="secondary" className="text-[10px]">All properties</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          {rule.property_ids.length} propert{rule.property_ids.length === 1 ? 'y' : 'ies'}
                        </Badge>
                      )}
                      {!rule.is_active && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {rule.instructions || 'No instructions yet.'}
                    </p>
                    {!rule.applies_to_all && rule.property_ids.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {rule.property_ids.map((id) => propertyName.get(id) ?? '…').join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleToggleActive(rule)}
                      title={rule.is_active ? 'Deactivate' : 'Activate'}
                      className={cn(
                        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                        rule.is_active
                          ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                          : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {rule.is_active ? 'Active' : 'Off'}
                    </button>
                    <button
                      onClick={() => setEditor({ mode: 'edit', rule })}
                      title="Edit"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule)}
                      disabled={deletingId === rule.id}
                      title="Delete"
                      className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </>
      )}
    </>
  );

  const content = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg-soft)] text-[var(--accent-3)]">
          <GraduationCap className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Concierge Training</h1>
          <p className="text-sm text-muted-foreground">
            Teach the AI how to handle guest situations and what to turn into tasks.
          </p>
        </div>
        <Link
          href="/messages/concierge-testing"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          Test replies
        </Link>
      </header>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {trainingPanel}
    </div>
  );

  return (
    <>
      {isMobile ? (
        <MobileRouteShell backHref="/messages" title="Concierge Training">
          {content}
        </MobileRouteShell>
      ) : (
        <DesktopSidebarShell>
          <div className="flex h-full flex-col overflow-auto">
            <div className="shrink-0 border-b border-[var(--surface-elevated-divider)] px-6 py-2">
              <Link
                href="/messages"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to Messages
              </Link>
            </div>
            {content}
          </div>
        </DesktopSidebarShell>
      )}

      {editor && (
        <RuleEditorDialog
          key={editor.mode === 'edit' ? editor.rule.id : 'create'}
          state={editor}
          properties={properties}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await loadRules();
          }}
        />
      )}
    </>
  );
}

function CategoryTabs({
  active,
  onChange,
}: {
  active: TrainingTab;
  onChange: (c: TrainingTab) => void;
}) {
  return (
    <div className="inline-flex gap-1 self-start rounded-lg border border-border bg-muted/40 p-1">
      {TAB_ORDER.map((key) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-[var(--accent-3)] text-white shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {TAB_META[key].label}
          </button>
        );
      })}
    </div>
  );
}

// Master on/off switch for a concierge capability (operations_settings flag).
// `enabled` is null while the flag is still loading.
function CapabilityToggle({
  capability,
  enabled,
  saving,
  onChange,
}: {
  capability: CapabilityKey;
  enabled: boolean | null;
  saving: boolean;
  onChange: (next: boolean) => void;
}) {
  const copy = CAPABILITY_COPY[capability];
  const isOn = enabled !== false; // treat the loading/unknown state as on
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{copy.title}</p>
            <Badge
              variant={enabled === false ? 'outline' : 'secondary'}
              className={cn('text-[10px]', enabled === false && 'text-muted-foreground')}
            >
              {enabled === null ? '…' : enabled ? 'On' : 'Off'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {enabled === null ? 'Loading…' : isOn ? copy.on : copy.off}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label={`${copy.title}: ${isOn ? 'on' : 'off'}`}
          disabled={enabled === null || saving}
          onClick={() => onChange(!isOn)}
          className={cn(
            'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            isOn ? 'bg-[var(--accent-3)]' : 'bg-neutral-300 dark:bg-neutral-600',
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              isOn ? 'translate-x-[22px]' : 'translate-x-0.5',
            )}
          />
        </button>
      </CardContent>
    </Card>
  );
}

const SENSITIVITY_LEVELS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: 'Critical only', blurb: 'Only urgent or safety issues, or anything making the space unusable.' },
  { level: 2, name: 'Clear operational work', blurb: 'Repairs, maintenance, supplies, and explicit “please do X” requests. (Default)' },
  { level: 3, name: 'Operational + administrative', blurb: 'Also booking/stay changes, special arrangements, and follow-ups that need an action — not just an answer.' },
  { level: 4, name: 'Proactive', blurb: 'Most actionable requests, plus notable feedback or preferences that likely need follow-up.' },
  { level: 5, name: 'Track everything', blurb: 'Almost any feedback, request, or issue worth tracking — skip only pure pleasantries.' },
];

function clampLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.round(n);
  return 2;
}

// Reply-draft sensitivity (1-4). Mirrors the server ladder in draftReply.ts.
const REPLY_SENSITIVITY_LEVELS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: 'Urgent only', blurb: 'Only when the guest has a time-sensitive problem or question that needs a prompt answer.' },
  { level: 2, name: 'Questions & issues', blurb: 'Also any genuine question, problem, or feedback that wants a response — urgent or not.' },
  { level: 3, name: 'Anything substantive', blurb: 'Also comments, plans, and requests that merit a reply. Skips pure “thanks”-style acknowledgments. (Default)' },
  { level: 4, name: 'Every message', blurb: 'Draft a reply to every inbound message, including simple acknowledgments.' },
];

function clampReplyLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 4) return Math.round(n);
  return 3;
}

/**
 * Org-level "how eager is the concierge to draft tasks" dial (1-5). Lives on the
 * Task rules tab because it's the other half of "what becomes a task." Persists
 * to operations_settings via PATCH /api/operations-settings.
 */
function SensitivityControl() {
  const [level, setLevel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/operations-settings', { cache: 'no-store' });
        const data = await res.json();
        if (active && res.ok) setLevel(clampLevel(data?.settings?.task_proposal_sensitivity));
        else if (active) setLevel(2);
      } catch {
        if (active) setLevel(2);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const update = async (next: number) => {
    const prev = level;
    setLevel(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/operations-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_proposal_sensitivity: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Failed to save');
        setLevel(prev);
      }
    } catch {
      setError('Failed to save');
      setLevel(prev);
    } finally {
      setSaving(false);
    }
  };

  const current = SENSITIVITY_LEVELS.find((l) => l.level === level);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Task proposal sensitivity</p>
            <p className="text-xs text-muted-foreground">
              How eager the concierge is to draft a task from a guest message. Applies everywhere; task rules below add specifics on top.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {SENSITIVITY_LEVELS.map((l) => {
              const active = level === l.level;
              return (
                <button
                  key={l.level}
                  type="button"
                  onClick={() => update(l.level)}
                  disabled={saving || level === null}
                  aria-pressed={active}
                  className={cn(
                    'h-8 w-9 rounded-md text-sm font-semibold transition-colors disabled:opacity-50',
                    active
                      ? 'bg-[var(--accent-3)] text-white shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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

        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground/80">
            What the levels mean
          </summary>
          <ul className="mt-2 space-y-1">
            {SENSITIVITY_LEVELS.map((l) => (
              <li key={l.level}>
                <span className="font-medium text-foreground">{l.level} · {l.name}</span> — {l.blurb}
              </li>
            ))}
          </ul>
          <p className="mt-2 italic">Levels are cumulative — each includes everything below it.</p>
        </details>
      </CardContent>
    </Card>
  );
}

/**
 * Org-level "how readily does the concierge draft a reply at all" dial (1-4).
 * Lives on the Replies tab beneath the capability switch. Gates the autonomous
 * draft path only; manual "Regenerate" always drafts. Persists to
 * operations_settings via PATCH /api/operations-settings.
 */
function ReplySensitivityControl() {
  const [level, setLevel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/operations-settings', { cache: 'no-store' });
        const data = await res.json();
        if (active && res.ok) setLevel(clampReplyLevel(data?.settings?.reply_proposal_sensitivity));
        else if (active) setLevel(3);
      } catch {
        if (active) setLevel(3);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const update = async (next: number) => {
    const prev = level;
    setLevel(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/operations-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply_proposal_sensitivity: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Failed to save');
        setLevel(prev);
      }
    } catch {
      setError('Failed to save');
      setLevel(prev);
    } finally {
      setSaving(false);
    }
  };

  const current = REPLY_SENSITIVITY_LEVELS.find((l) => l.level === level);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--accent-3)]" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Reply sensitivity</p>
            <p className="text-xs text-muted-foreground">
              How readily the concierge drafts a reply to an inbound message. Applies to autonomous drafts only — you can always draft manually in the inbox.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {REPLY_SENSITIVITY_LEVELS.map((l) => {
              const active = level === l.level;
              return (
                <button
                  key={l.level}
                  type="button"
                  onClick={() => update(l.level)}
                  disabled={saving || level === null}
                  aria-pressed={active}
                  className={cn(
                    'h-8 w-9 rounded-md text-sm font-semibold transition-colors disabled:opacity-50',
                    active
                      ? 'bg-[var(--accent-3)] text-white shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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

        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground/80">
            What the levels mean
          </summary>
          <ul className="mt-2 space-y-1">
            {REPLY_SENSITIVITY_LEVELS.map((l) => (
              <li key={l.level}>
                <span className="font-medium text-foreground">{l.level} · {l.name}</span> — {l.blurb}
              </li>
            ))}
          </ul>
          <p className="mt-2 italic">Levels are cumulative — each includes everything below it.</p>
        </details>
      </CardContent>
    </Card>
  );
}

function RuleEditorDialog({
  state,
  properties,
  onClose,
  onSaved,
}: {
  state: Exclude<EditorState, null>;
  properties: PropertyOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const existing = state.mode === 'edit' ? state.rule : null;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [category, setCategory] = useState<TrainingCategory>(
    existing?.category ?? (state.mode === 'create' ? state.category : 'reply'),
  );
  const [appliesToAll, setAppliesToAll] = useState(existing?.applies_to_all ?? false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(existing?.property_ids ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const propertyOptions = useMemo<FilterOption[]>(
    () => properties.map((p) => ({ value: p.id, label: p.name })),
    [properties],
  );

  const canSave = title.trim().length > 0 && (appliesToAll || selected.size > 0);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      title: title.trim(),
      instructions: instructions.trim(),
      category,
      applies_to_all: appliesToAll,
      property_ids: appliesToAll ? [] : [...selected],
    };
    try {
      const res = await fetch(
        existing ? `/api/concierge-training/${existing.id}` : '/api/concierge-training',
        {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save training');
      await onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save training');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit training' : 'New training'}</DialogTitle>
          <DialogDescription>
            {category === 'task'
              ? 'Guides when and how the AI drafts operational tasks from guest messages.'
              : 'A named procedure the AI follows when drafting guest replies for the selected properties.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Training type</Label>
            <div className="flex items-center gap-2">
              {(['reply', 'task'] as TrainingCategory[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    category === c
                      ? 'border-[var(--accent-3)] bg-[var(--accent-bg-soft)] text-[var(--accent-3)]'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-title">Title</Label>
            <Input
              id="rule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`e.g. ${CATEGORY_META[category].placeholderTitle}`}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-instructions">Instructions</Label>
            <Textarea
              id="rule-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Step-by-step guidance the AI should follow when this situation comes up…"
              rows={8}
              className="resize-y"
            />
          </div>

          <div className="space-y-2">
            <Label>Applies to</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAppliesToAll(true)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                  appliesToAll
                    ? 'border-[var(--accent-3)] bg-[var(--accent-bg-soft)] text-[var(--accent-3)]'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                All properties
              </button>
              <button
                type="button"
                onClick={() => setAppliesToAll(false)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                  !appliesToAll
                    ? 'border-[var(--accent-3)] bg-[var(--accent-bg-soft)] text-[var(--accent-3)]'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                Specific properties
              </button>
            </div>
            {!appliesToAll && (
              <div className="pt-1">
                <MultiSelect
                  label="Properties"
                  options={propertyOptions}
                  selected={selected}
                  onChange={setSelected}
                  searchable
                />
                {selected.size === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Select at least one property, or switch to “All properties”.
                  </p>
                )}
              </div>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create training'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
