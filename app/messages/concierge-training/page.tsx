'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2, ChevronDown, Check, Home, Layers, Sparkles, X } from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TranscriptScript } from '@/components/messages/TranscriptScript';
import { ExampleTranscriptField } from '@/components/messages/ExampleTranscriptField';
import InfoTooltip from '@/components/templates/InfoTooltip';
import { cn } from '@/lib/utils';

// CRUD-backed training lives under two categories (reply / task). Property
// knowledge is on/off only and lives entirely on the Settings page now.
type TrainingCategory = 'reply' | 'task';
// 'always' = pinned into every reply. 'situational' = loaded on demand when the
// guest's message matches (keeps replies focused as the rule set grows).
type TrainingTier = 'always' | 'situational';

interface TrainingExample {
  id: string;
  label: string | null;
  transcript: string;
}

interface TrainingRule {
  id: string;
  title: string;
  instructions: string;
  category: TrainingCategory;
  tier: TrainingTier;
  applies_to_all: boolean;
  is_active: boolean;
  sort_order: number;
  property_ids: string[];
  examples: TrainingExample[];
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

// Agent-exposure choices — the two ways a block reaches the agent. The dialog
// shows just the titles; the full descriptions are surfaced on the page (see
// ExposureLegend). The guiding question is FREQUENCY: how often is it relevant?
const TIER_OPTIONS: { value: TrainingTier; title: string; description: string }[] = [
  {
    value: 'always',
    title: 'Always in context',
    description:
      "Best for rules that are relevant to almost every AI-generated message — tone, personality, privacy, or safety. If the instructions aren't fundamental to the Concierge Agent's behavior, selecting Tool is likely the optimal choice.",
  },
  {
    value: 'situational',
    title: 'Tools',
    description:
      "Best for procedures that only come up occasionally — prevents bloating the Agent's memory and context.",
  },
];

// Shared compact pill trigger (Active / Properties / Agent exposure controls).
const PILL_CLASS =
  'inline-flex h-9 items-center gap-2 rounded-full border border-border bg-transparent px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-[var(--accent-3)]/40 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/[0.06]';

// Rough, tunable context-load estimate for one category's active rules. An
// injected (always) block costs its full token weight on EVERY message; an
// on-demand (situational/Tool) block costs little — a menu entry plus a small
// "one more thing to choose between" tax. Quiet guardrail + reassurance, not a
// precise budget; the ceiling and bands are heuristics, kept here to retune.
// Both categories load situational rules on demand (replies via draftReply, tasks
// via draftTask), so the same tier split applies to each.
const LOAD_CEILING = 8000; // effective tokens where standing instruction turns heavy
const TOOL_EFFECTIVE_TOKENS = 50; // per on-demand block: menu line + selection tax

function estimateContextLoad(rules: TrainingRule[]) {
  const active = rules.filter((r) => r.is_active);
  const injected = active.filter((r) => r.tier !== 'situational');
  const toolCount = active.filter((r) => r.tier === 'situational').length;
  // Always-tier blocks ride in every prompt — count their title, instructions,
  // AND their worked-example transcripts, since examples are injected too.
  const injectedTokens = injected.reduce((sum, r) => {
    const exampleChars = r.examples.reduce(
      (s, e) => s + e.transcript.length + (e.label?.length ?? 0),
      0,
    );
    return sum + Math.ceil((r.instructions.length + r.title.length + exampleChars) / 4);
  }, 0);
  const effective = injectedTokens + toolCount * TOOL_EFFECTIVE_TOKENS;
  const pct = Math.min(100, Math.round((effective / LOAD_CEILING) * 100));
  const level: 'light' | 'moderate' | 'heavy' = pct < 55 ? 'light' : pct < 85 ? 'moderate' : 'heavy';
  return { injectedTokens, toolCount, pct, level };
}

// Tab chrome for the two CRUD categories.
const TAB_META: Record<TrainingCategory, { label: string; blurb: string }> = {
  reply: { label: 'Replies', blurb: CATEGORY_META.reply.blurb },
  task: { label: 'Tasks', blurb: CATEGORY_META.task.blurb },
};

const TAB_ORDER: TrainingCategory[] = ['reply', 'task'];

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
  const [activeTab, setActiveTab] = useState<TrainingCategory>('reply');
  const [rules, setRules] = useState<TrainingRule[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<EditorState>(null);

  const visibleRules = useMemo(
    () => rules.filter((r) => r.category === activeTab),
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
        const [, propsRes] = await Promise.all([
          loadRules(),
          fetch('/api/properties').then((r) => r.json()),
        ]);
        if (!active) return;
        setProperties(
          Array.isArray(propsRes?.properties)
            ? propsRes.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
            : [],
        );
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

  // Deep link from the inbox's "Referenced Training Blocks" popup: ?rule=<id>
  // opens straight to that block's editor. Read from window.location rather than
  // useSearchParams so the page needs no Suspense boundary, and strip the param
  // immediately so a refresh or back-nav doesn't reopen the dialog.
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('rule');
    if (!id) return;
    setPendingRuleId(id);
    params.delete('rule');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);

  // Once the rules have loaded, open the deep-linked block (switching to its tab
  // so the list behind the dialog matches). If it was since deleted, we just
  // land on the page — the param is already cleared either way.
  useEffect(() => {
    if (!pendingRuleId || loading) return;
    const rule = rules.find((r) => r.id === pendingRuleId);
    setPendingRuleId(null);
    if (rule) {
      setActiveTab(rule.category);
      setEditor({ mode: 'edit', rule });
    }
  }, [pendingRuleId, loading, rules]);

  const trainingPanel = (
    <>
      <div className="flex items-center justify-between gap-3">
        <CategoryTabs active={activeTab} onChange={setActiveTab} />
        <Button className="rounded-full" onClick={() => setEditor({ mode: 'create', category: activeTab })}>
          <Plus className="mr-2 h-4 w-4" />
          Training block
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visibleRules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/[0.12] py-12 text-center dark:border-white/[0.12]">
          <p className="mb-4 text-sm text-muted-foreground">
            No {CATEGORY_META[activeTab].label.toLowerCase()} blocks yet. Add your first — e.g.
            “{CATEGORY_META[activeTab].placeholderTitle}”.
          </p>
          <Button className="rounded-full" onClick={() => setEditor({ mode: 'create', category: activeTab })}>
            <Plus className="mr-2 h-4 w-4" />
            Create your first
          </Button>
        </div>
      ) : (
        <>
          <ContextLoadBar rules={visibleRules} />
          {TIER_OPTIONS.map((opt) => (
            <ExposureGroup
              key={opt.value}
              option={opt}
              rules={visibleRules.filter((r) =>
                opt.value === 'situational' ? r.tier === 'situational' : r.tier !== 'situational',
              )}
              onEdit={(rule) => setEditor({ mode: 'edit', rule })}
            />
          ))}
        </>
      )}
    </>
  );

  const content = (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6 sm:px-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Concierge Training</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Teach the Concierge Agent how to reply to guests, handle situations, and execute task
          generation.
        </p>
      </header>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3 text-sm text-red-700 dark:border-red-400/25 dark:bg-red-400/[0.08] dark:text-red-300">
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
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="msg-divider shrink-0 border-b px-4 py-2.5">
              <Link
                href="/messages"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to Messages
              </Link>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar [scrollbar-gutter:stable]">{content}</div>
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
          onDeleted={async () => {
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
  active: TrainingCategory;
  onChange: (c: TrainingCategory) => void;
}) {
  return (
    <div className="msg-well inline-flex shrink-0 gap-1 rounded-lg p-1">
      {TAB_ORDER.map((key) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-[var(--accent-3)] text-white shadow-sm'
                : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]',
            )}
          >
            {TAB_META[key].label}
          </button>
        );
      })}
    </div>
  );
}

// Quiet context-load gauge for the active tab's blocks. Reassurance most of the
// time (light); only speaks up with advice once it's getting full. It's a
// ceiling guardrail, NOT a per-block recommendation — which block to inject vs.
// keep on demand is a frequency/criticality call the operator makes per block.
function ContextLoadBar({ rules }: { rules: TrainingRule[] }) {
  const { injectedTokens, toolCount, pct, level } = useMemo(
    () => estimateContextLoad(rules),
    [rules],
  );
  const META = {
    light: { label: 'Light', bar: 'bg-emerald-500', advice: '' },
    moderate: {
      label: 'Moderate',
      bar: 'bg-amber-500',
      advice: 'Getting fuller — consider moving rarely-used blocks to “on demand”.',
    },
    heavy: {
      label: 'Heavy',
      bar: 'bg-[var(--destructive)]',
      advice:
        'A lot of standing instruction. Audit for overlap, trim, or move rarely-used blocks to “on demand”.',
    },
  } as const;
  const meta = META[level];
  return (
    <div className="msg-well space-y-2 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Context load · {meta.label}</p>
        <span className="text-xs tabular-nums text-muted-foreground">
          ~{injectedTokens.toLocaleString()} always-on tokens
          {toolCount > 0 ? ` · ${toolCount} on demand` : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]">
        <div
          className={cn('h-full rounded-full transition-all duration-300', meta.bar)}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
      {meta.advice && <p className="text-xs text-muted-foreground">{meta.advice}</p>}
    </div>
  );
}

// A tier section on the page: the exposure blip (label + description) followed by
// the blocks of that tier. The descriptions live here, not in the dialog.
function ExposureGroup({
  option,
  rules,
  onEdit,
}: {
  option: (typeof TIER_OPTIONS)[number];
  rules: TrainingRule[];
  onEdit: (rule: TrainingRule) => void;
}) {
  return (
    <section className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-foreground">{option.title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{option.description}</p>
      </div>
      {rules.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No blocks here yet.</p>
      ) : (
        <div className="msg-well overflow-hidden rounded-xl">
          {rules.map((rule, idx) => (
            <TrainingBlockRow
              key={rule.id}
              rule={rule}
              isLast={idx === rules.length - 1}
              onEdit={() => onEdit(rule)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// Compact training-block row — title + property scope + edit pencil. The whole
// row opens the editor (where instructions, active state, and delete live);
// nothing else is shown inline. Styled to echo the My Assignments task rows.
function TrainingBlockRow({
  rule,
  isLast,
  onEdit,
}: {
  rule: TrainingRule;
  isLast: boolean;
  onEdit: () => void;
}) {
  const scope = rule.applies_to_all
    ? 'All properties'
    : rule.property_ids.length === 0
      ? 'No properties'
      : `${rule.property_ids.length} ${rule.property_ids.length === 1 ? 'property' : 'properties'}`;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
        !isLast && 'border-b border-black/[0.06] dark:border-white/[0.06]',
        !rule.is_active && 'opacity-55',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{rule.title}</span>
        {!rule.is_active && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
            Off
          </Badge>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{scope}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Edit"
        aria-label={`Edit ${rule.title}`}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RuleEditorDialog({
  state,
  properties,
  onClose,
  onSaved,
  onDeleted,
}: {
  state: Exclude<EditorState, null>;
  properties: PropertyOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const existing = state.mode === 'edit' ? state.rule : null;
  // Category is implicit — it follows the tab the user was on (create) or the
  // block being edited. No in-dialog type switch.
  const category: TrainingCategory =
    existing?.category ?? (state.mode === 'create' ? state.category : 'reply');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  // New blocks default to active.
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  // Reply rules only: always-on vs loaded-on-demand. Defaults to 'always'.
  const [tier, setTier] = useState<TrainingTier>(existing?.tier ?? 'always');
  // applies_to_all is folded into the property picker: every property selected
  // == "all properties". Seed an applies-to-all block with everything checked.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(existing?.applies_to_all ? properties.map((p) => p.id) : existing?.property_ids ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // AI-assisted authoring: structure a plain-language note into the fields. Only
  // offered for a brand-new block, and only until it's been generated once —
  // re-drafting a populated block would clobber it (delete + recreate instead).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [structuring, setStructuring] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Worked examples (edit mode only — a new block has no id to attach them to
  // yet; promote-from-conversation is where new blocks get their first example).
  const [examples, setExamples] = useState<TrainingExample[]>(existing?.examples ?? []);
  const [exampleDraft, setExampleDraft] = useState<{ label: string; transcript: string } | null>(null);
  const [savingExample, setSavingExample] = useState(false);

  const allSelected = properties.length > 0 && selected.size === properties.length;
  const canSave = title.trim().length > 0 && selected.size > 0;

  const handleAiDraft = async () => {
    const note = aiNote.trim();
    if (!note) return;
    setStructuring(true);
    setFormError(null);
    try {
      const res = await fetch('/api/concierge-training/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'note', note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to draft with AI');
      const draft = data.draft ?? {};
      if (typeof draft.title === 'string' && draft.title) setTitle(draft.title);
      if (typeof draft.instructions === 'string') setInstructions(draft.instructions);
      if (draft.tier === 'always' || draft.tier === 'situational') setTier(draft.tier);
      setAiOpen(false);
      setAiNote('');
      setHasGenerated(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to draft with AI');
    } finally {
      setStructuring(false);
    }
  };

  const handleAddExample = async () => {
    if (!existing || !exampleDraft || !exampleDraft.transcript.trim()) return;
    setSavingExample(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/concierge-training/${existing.id}/examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: exampleDraft.label.trim() || null,
          transcript: exampleDraft.transcript.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to add example');
      setExamples((prev) => [...prev, data.example as TrainingExample]);
      setExampleDraft(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add example');
    } finally {
      setSavingExample(false);
    }
  };

  const handleRemoveExample = async (exampleId: string) => {
    if (!existing) return;
    setFormError(null);
    try {
      const res = await fetch(`/api/concierge-training/${existing.id}/examples/${exampleId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to remove example');
      }
      setExamples((prev) => prev.filter((e) => e.id !== exampleId));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to remove example');
    }
  };

  const handleUpdateExample = async (
    exampleId: string,
    patch: { label: string | null; transcript: string },
  ): Promise<boolean> => {
    if (!existing) return false;
    setFormError(null);
    try {
      const res = await fetch(`/api/concierge-training/${existing.id}/examples/${exampleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update example');
      setExamples((prev) => prev.map((e) => (e.id === exampleId ? (data.example as TrainingExample) : e)));
      return true;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update example');
      return false;
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      title: title.trim(),
      instructions: instructions.trim(),
      category,
      tier,
      applies_to_all: allSelected,
      is_active: isActive,
      property_ids: allSelected ? [] : [...selected],
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
      if (!res.ok) throw new Error(data?.error || 'Failed to save training block');
      await onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save training block');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    if (!confirm(`Delete “${existing.title}”? This cannot be undone.`)) return;
    setDeleting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/concierge-training/${existing.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete training block');
      await onDeleted();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete training block');
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="flex h-[min(90svh,640px)] flex-col gap-0 overflow-hidden border-[var(--surface-elevated-line)] bg-[var(--surface-elevated)] p-0 shadow-[var(--glass-shadow)] sm:max-w-4xl"
      >
        {/* Frosted grey-blue sheen over the solid surface. On a NON-transformed
            layer (Radix transforms the content, which would drop the blur); the
            solid bg-popover under it keeps the dialog opaque, not see-through. */}
        <div
          className="liquid-glass-surface pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
          aria-hidden
        />
        <DialogHeader className="sr-only">
          <DialogTitle>{existing ? 'Edit training block' : 'New training block'}</DialogTitle>
        </DialogHeader>

        {/* Doc-editor layout: title + a wide instructions field, with the
            settings as compact pills at the bottom. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 pt-6 pb-4 overlay-scrollbar">
          {aiOpen ? (
            /* Focused "draft page" — only the note box while drafting, so the AI
               result can't be confused with (or clobber) manual edits. */
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Draft with AI from a note</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Describe the rule in plain words; the AI structures it into a training block you
                  can review before saving.
                </p>
              </div>
              <Textarea
                value={aiNote}
                onChange={(e) => setAiNote(e.target.value)}
                placeholder="Describe it in plain words — e.g. “don’t promise early check-in unless it’s confirmed”…"
                className="field-sizing-fixed min-h-[12rem] flex-1 resize-none overflow-y-auto text-base leading-relaxed overlay-scrollbar"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    setAiOpen(false);
                    setAiNote('');
                  }}
                  disabled={structuring}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={handleAiDraft}
                  disabled={structuring || !aiNote.trim()}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {structuring ? 'Drafting…' : 'Draft with AI'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Entry — only for a brand-new, not-yet-generated block. Redrafting a
                  populated/existing block would overwrite it; delete + recreate instead. */}
              {!existing && !hasGenerated ? (
                <button
                  type="button"
                  onClick={() => setAiOpen(true)}
                  disabled={!isActive}
                  className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[var(--accent-3)] transition-colors hover:underline disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Draft with AI from a note
                </button>
              ) : null}

          {/* Title — full width */}
          <Input
            id="rule-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            disabled={!isActive}
            className="h-11 w-full text-base"
          />

          {/* Instructions — fills the remaining height, scrolls internally */}
          <Textarea
            id="rule-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={!isActive}
            placeholder={
              category === 'task'
                ? 'When should the Concierge Agent create a task from a guest message, and what should it contain?…'
                : 'Step-by-step guidance the Concierge Agent should follow when this situation comes up…'
            }
            className="field-sizing-fixed min-h-[10rem] flex-1 resize-none overflow-y-auto text-base leading-relaxed overlay-scrollbar"
          />

          {/* Settings pills, below the instructions. Active stays live; the rest
              lock when the block is off. Properties + exposure open popovers. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label={`Active: ${isActive ? 'on' : 'off'}`}
              onClick={() => setIsActive((v) => !v)}
              className={cn(PILL_CLASS, !isActive && 'text-muted-foreground')}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
              />
              {isActive ? 'Active' : 'Inactive'}
            </button>

            <PropertyPicker
              properties={properties}
              selected={selected}
              onChange={setSelected}
              disabled={!isActive}
            />

            <ExposurePill tier={tier} onChange={setTier} disabled={!isActive} />
          </div>

          {/* Worked examples — edit mode only. A new block gets its first example
              by being created from a conversation ("Turn into training"). */}
          {existing && (
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground">
                    Messaging Examples for AI&apos;s Reference
                  </p>
                  <InfoTooltip text="Manually add example message exchanges between a host and a guest that show the Concierge Agent how you want it to reply. You can also capture real exchanges from a live chat: open a conversation, choose “Turn into training”, and select the messages to start a new block or add to an existing one for the Agent to reference." />
                </div>
                {!exampleDraft && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setExampleDraft({ label: '', transcript: '' })}
                    disabled={!isActive}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add example
                  </Button>
                )}
              </div>

              {examples.length === 0 && !exampleDraft ? (
                <p className="text-xs text-muted-foreground">No examples yet.</p>
              ) : (
                <div className="space-y-2">
                  {examples.map((ex) => (
                    <ExampleRow
                      key={ex.id}
                      example={ex}
                      disabled={!isActive}
                      onSave={handleUpdateExample}
                      onRemove={() => handleRemoveExample(ex.id)}
                    />
                  ))}
                </div>
              )}

              {exampleDraft && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <Input
                    value={exampleDraft.label}
                    onChange={(e) =>
                      setExampleDraft((d) => (d ? { ...d, label: e.target.value } : d))
                    }
                    placeholder="Label (optional) — what does this show?"
                    className="h-9 text-sm"
                  />
                  <ExampleTranscriptField
                    value={exampleDraft.transcript}
                    onChange={(next) => setExampleDraft((d) => (d ? { ...d, transcript: next } : d))}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setExampleDraft(null)}
                      disabled={savingExample}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={handleAddExample}
                      disabled={savingExample || !exampleDraft.transcript.trim()}
                    >
                      {savingExample ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
            </>
          )}

        </div>

        {formError && (
          <p className="px-7 pt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
        )}

        {/* While drafting, the note page has its own Cancel/Draft actions — the
            footer's Cancel/Create aren't usable yet, so hide the whole bar. */}
        {!aiOpen && (
          <DialogFooter className="border-t border-border px-7 py-4 sm:justify-between">
            {existing ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-full text-red-500 hover:bg-red-500/[0.08] hover:text-red-600 dark:hover:bg-red-500/[0.12]"
                onClick={handleDelete}
                disabled={deleting || saving}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
              <Button className="rounded-full" onClick={handleSave} disabled={saving || deleting || !canSave}>
                {saving ? 'Saving…' : existing ? 'Save changes' : 'Create training block'}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// One saved worked example in the editor: screenplay-style transcript (same
// TranscriptScript rendering as the promote dialog) with edit + delete. "Edit"
// swaps to a label field + monospace textarea and PATCHes on save.
function ExampleRow({
  example,
  disabled,
  onSave,
  onRemove,
}: {
  example: TrainingExample;
  disabled: boolean;
  onSave: (id: string, patch: { label: string | null; transcript: string }) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState(example.label ?? '');
  const [transcript, setTranscript] = useState(example.transcript);
  const [saving, setSaving] = useState(false);
  // Two-step delete: the X arms a confirm prompt rather than deleting outright,
  // since a removed exchange is hard to recover.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Collapsed by default — show just the label (or a first-line preview when
  // unlabeled); the transcript reveals on expand.
  const summary =
    example.label ||
    example.transcript.split('\n').find((l) => l.trim())?.trim() ||
    'Example';

  const start = () => {
    setLabel(example.label ?? '');
    setTranscript(example.transcript);
    setEditing(true);
  };
  const save = async () => {
    if (!transcript.trim()) return;
    setSaving(true);
    const ok = await onSave(example.id, {
      label: label.trim() || null,
      transcript: transcript.trim(),
    });
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional) — what this example shows"
          className="h-9 text-sm"
        />
        <ExampleTranscriptField value={transcript} onChange={setTranscript} />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            onClick={save}
            disabled={saving || !transcript.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
          />
          <span
            className={cn(
              'truncate text-xs font-medium',
              example.label ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {summary}
          </span>
        </button>
        {confirmingDelete ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Delete?</span>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                onRemove();
              }}
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-500/[0.10] dark:text-red-400"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={start}
              disabled={disabled}
              aria-label="Edit example"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Remove example"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-red-600 dark:hover:bg-white/[0.08]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3">
          <TranscriptScript transcript={example.transcript} />
        </div>
      )}
    </div>
  );
}

// Multi-select properties field. Built on Radix Popover so the menu portals out
// of the dialog (escaping its overflow, no dialog scrollbar), stays on-screen via
// collision handling, and coordinates focus/dismiss with the parent dialog.
// "Select all" checks every property — the parent reads "all selected" as
// applies-to-all.
function PropertyPicker({
  properties,
  selected,
  onChange,
  disabled = false,
}: {
  properties: PropertyOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const total = properties.length;
  const allSelected = total > 0 && selected.size === total;
  const summary = allSelected
    ? 'All properties'
    : selected.size === 0
      ? 'Select properties'
      : `${selected.size} ${selected.size === 1 ? 'property' : 'properties'} selected`;

  const filtered = query
    ? properties.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : properties;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
      modal
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          disabled={disabled}
          className={cn(PILL_CLASS, selected.size === 0 && 'text-muted-foreground')}
        >
          <Home className="h-3.5 w-3.5 opacity-70" />
          <span className="max-w-[12rem] truncate">{summary}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      {/* Portals over the dialog; fixed width (the pill trigger is small), height
          capped to the space available so it never runs off-screen. */}
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="flex max-h-[min(340px,var(--radix-popover-content-available-height))] w-72 flex-col overflow-hidden rounded-lg border border-border p-0 shadow-lg"
      >
        <div className="shrink-0 border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search properties…"
            className="h-9"
          />
        </div>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => onChange(new Set(properties.map((p) => p.id)))}
            className="font-medium text-[var(--accent-3)] hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 overlay-scrollbar">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {total === 0 ? 'No properties yet.' : 'No matches.'}
            </p>
          ) : (
            filtered.map((p) => {
              const checked = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked
                        ? 'border-[var(--accent-3)] bg-[var(--accent-3)] text-white'
                        : 'border-muted-foreground/40',
                    )}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="truncate text-foreground">{p.name}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Agent-exposure pill: a popover with just the two option labels (Always in
// context / Tools). The full descriptions live on the page (ExposureLegend), so
// the dialog stays lean.
function ExposurePill({
  tier,
  onChange,
  disabled = false,
}: {
  tier: TrainingTier;
  onChange: (next: TrainingTier) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = TIER_OPTIONS.find((o) => o.value === tier)?.title ?? 'Always in context';
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button type="button" aria-expanded={open} disabled={disabled} className={PILL_CLASS}>
          <Layers className="h-3.5 w-3.5 opacity-70" />
          <span className="truncate">{label}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} collisionPadding={12} className="w-64 p-1.5">
        {TIER_OPTIONS.map((opt) => {
          const on = tier === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                on
                  ? 'bg-[var(--accent-3)]/[0.10] font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  on ? 'border-[var(--accent-3)]' : 'border-muted-foreground/50',
                )}
              >
                {on && <span className="h-2 w-2 rounded-full bg-[var(--accent-3)]" />}
              </span>
              {opt.title}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
