'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2, ChevronDown, Check } from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// CRUD-backed training lives under two categories (reply / task). Property
// knowledge is on/off only and lives entirely on the Settings page now.
type TrainingCategory = 'reply' | 'task';
// 'always' = pinned into every reply. 'situational' = loaded on demand when the
// guest's message matches (keeps replies focused as the rule set grows).
type TrainingTier = 'always' | 'situational';

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

// Classification choices for reply rules — the two ways a block reaches the agent.
const TIER_OPTIONS: { value: TrainingTier; title: string; points: string[] }[] = [
  {
    value: 'always',
    title: 'Automatically in the context window',
    points: [
      'Kept in the agent’s context on every message, so it’s always in play.',
      'Best for general rules like tone, privacy, or policy.',
    ],
  },
  {
    value: 'situational',
    title: 'Available for the agent to reference on demand',
    points: [
      'Left out of context by default; the agent pulls it in itself (via a tool) only when the guest’s message is about this topic.',
      'Keeps every reply lean and focused as your rules grow.',
    ],
  },
];

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
        <div className="msg-well overflow-hidden rounded-xl">
          {visibleRules.map((rule, idx) => (
            <TrainingBlockRow
              key={rule.id}
              rule={rule}
              isLast={idx === visibleRules.length - 1}
              onEdit={() => setEditor({ mode: 'edit', rule })}
            />
          ))}
        </div>
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
          <div className="glass-bg-neutral flex h-full p-2.5">
            <div className="msg-pane flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="msg-divider shrink-0 border-b px-4 py-2.5">
                <Link
                  href="/messages"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back to Messages
                </Link>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar">{content}</div>
            </div>
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
        {rule.category === 'reply' && rule.tier === 'situational' && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
            On demand
          </Badge>
        )}
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
  // New blocks start inactive — the operator turns them on deliberately.
  const [isActive, setIsActive] = useState(existing?.is_active ?? false);
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

  const allSelected = properties.length > 0 && selected.size === properties.length;
  const canSave = title.trim().length > 0 && selected.size > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      title: title.trim(),
      instructions: instructions.trim(),
      category,
      // Tier only governs reply drafting; task rules are always injected.
      tier: category === 'reply' ? tier : 'always',
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

        {/* Fixed footprint; the body fills it and only scrolls if the viewport is short. */}
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-7 pt-6 pb-5 overlay-scrollbar">
          {/* Title fills the row; the active toggle sits at the right. The toggle
              stays live even when off; everything else is muted and locked. */}
          <div className="flex items-center gap-3">
            <Input
              id="rule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              autoFocus={isActive}
              disabled={!isActive}
              className="h-11 flex-1 text-base"
            />
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label={`Active: ${isActive ? 'on' : 'off'}`}
              title={isActive ? 'Active' : 'Inactive'}
              onClick={() => setIsActive((v) => !v)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                isActive ? 'bg-[var(--accent-3)]' : 'bg-black/[0.18] dark:bg-white/[0.22]',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  isActive ? 'translate-x-[18px]' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          {/* Settings on the left, instructions on the right. Muted + locked when inactive. */}
          <div
            className={cn(
              'grid min-h-0 flex-1 gap-x-8 gap-y-6 sm:grid-cols-2',
              !isActive && 'pointer-events-none select-none opacity-50',
            )}
            aria-disabled={!isActive}
          >
            <div className="flex min-h-0 flex-col gap-6">
              {category === 'reply' && (
                <div>
                  <p className="text-sm font-medium text-foreground">Classification</p>
                  <div className="mt-2.5 space-y-2">
                    {TIER_OPTIONS.map((opt) => {
                      const isOn = tier === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setTier(opt.value)}
                          disabled={!isActive}
                          aria-pressed={isOn}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg border p-3 text-left text-sm font-medium transition-colors',
                            isOn
                              ? 'border-[var(--accent-3)] bg-[var(--accent-3)]/[0.08] text-foreground'
                              : 'border-border text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                              isOn ? 'border-[var(--accent-3)]' : 'border-muted-foreground/50',
                            )}
                          >
                            {isOn && <span className="h-2 w-2 rounded-full bg-[var(--accent-3)]" />}
                          </span>
                          <span className="min-w-0">{opt.title}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {TIER_OPTIONS.find((o) => o.value === tier)?.points.map((pt) => (
                      <li key={pt} className="flex gap-2 text-sm leading-relaxed text-foreground">
                        <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground/70" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Properties — no label; the trigger reads "All properties" / a count. */}
              <div className="space-y-1.5">
                <PropertyPicker
                  properties={properties}
                  selected={selected}
                  onChange={setSelected}
                  disabled={!isActive}
                />
                {selected.size === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Select at least one property, or use “Select all”.
                  </p>
                )}
              </div>
            </div>

            {/* Instructions — fills the column height, scrolls internally. */}
            <div className="flex min-h-0 flex-col">
              <Label htmlFor="rule-instructions" className="mb-2 text-sm font-medium">
                Instructions
              </Label>
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
                className="field-sizing-fixed min-h-[12rem] flex-1 resize-none overflow-y-auto text-base leading-relaxed overlay-scrollbar"
              />
            </div>
          </div>
        </div>

        {formError && (
          <p className="px-7 pt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
        )}

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
      </DialogContent>
    </Dialog>
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
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-transparent px-3.5 text-base transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60',
            selected.size === 0 ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 opacity-60 transition-transform', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      {/* Portals over the dialog; width matches the trigger, height capped to the
          space available so it never runs off-screen. */}
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="flex max-h-[min(340px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden rounded-lg border border-border p-0 shadow-lg"
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
