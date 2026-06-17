'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';

// CRUD-backed training lives under two categories (reply / task). Property
// knowledge is on/off only and lives entirely on the Settings page now.
type TrainingCategory = 'reply' | 'task';

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
    <div className="flex w-full flex-col gap-4 p-6 sm:px-8">
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
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
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
      <DialogContent aria-describedby={undefined} className="gap-5 p-7 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{existing ? 'Edit training block' : 'New training block'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Active / inactive — first control in the dialog. */}
          <div className="flex items-center justify-between rounded-xl border border-border p-4">
            <div className="min-w-0">
              <p className="text-base font-medium text-foreground">
                {isActive ? 'Active' : 'Inactive'}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isActive
                  ? 'The Concierge Agent follows this training block.'
                  : 'Turned off — the Concierge Agent ignores this block.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label={`Active: ${isActive ? 'on' : 'off'}`}
              onClick={() => setIsActive((v) => !v)}
              className={cn(
                'relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full transition-colors',
                isActive ? 'bg-[var(--accent-3)]' : 'bg-black/[0.15] dark:bg-white/[0.18]',
              )}
            >
              <span
                className={cn(
                  'inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform',
                  isActive ? 'translate-x-[23px]' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="rule-title" className="text-sm font-medium">Title</Label>
            <Input
              id="rule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`e.g. ${CATEGORY_META[category].placeholderTitle}`}
              autoFocus
              className="h-11 text-base"
            />
          </div>

          {/* Properties */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Properties</Label>
            <PropertyPicker properties={properties} selected={selected} onChange={setSelected} />
            {selected.size === 0 && (
              <p className="text-xs text-muted-foreground">
                Select at least one property, or use “Select all”.
              </p>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <Label htmlFor="rule-instructions" className="text-sm font-medium">Instructions</Label>
            <Textarea
              id="rule-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                category === 'task'
                  ? 'When should the Concierge Agent create a task from a guest message, and what should it contain?…'
                  : 'Step-by-step guidance the Concierge Agent should follow when this situation comes up…'
              }
              rows={10}
              className="resize-y text-base leading-relaxed"
            />
          </div>

          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
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

// Multi-select properties field for the editor dialog. Anchored inline (no fixed
// portal) so it stays within the dialog and never runs off-screen. "Select all"
// checks every property — the parent reads "all selected" as applies-to-all.
function PropertyPicker({
  properties,
  selected,
  onChange,
}: {
  properties: PropertyOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

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
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-transparent px-3.5 text-base transition-colors hover:bg-accent',
          selected.size === 0 ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 opacity-60 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search properties…"
              className="h-9"
            />
          </div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
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
          <div className="max-h-60 overflow-y-auto py-1 overlay-scrollbar">
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
        </div>
      )}
    </div>
  );
}
