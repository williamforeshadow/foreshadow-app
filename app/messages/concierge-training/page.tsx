'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  GraduationCap,
  FlaskConical,
  SendHorizontal,
  Loader2,
  RotateCcw,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect, type FilterOption } from '@/components/tasks/TaskFilterBar';
import { cn } from '@/lib/utils';

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
    label: 'Reply rules',
    blurb: 'Procedures the AI follows when drafting guest replies.',
    placeholderTitle: 'Door Lock Troubleshooting',
  },
  task: {
    label: 'Task rules',
    blurb: 'When and how the AI should draft operational tasks from guest messages.',
    placeholderTitle: 'Create a maintenance task for AC issues',
  },
};

interface PropertyOption {
  id: string;
  name: string;
}

type Section = 'training' | 'test';

type EditorState =
  | { mode: 'create'; category: TrainingCategory }
  | { mode: 'edit'; rule: TrainingRule }
  | null;

export default function ConciergeTrainingPage() {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<Section>('training');
  const [categoryFilter, setCategoryFilter] = useState<TrainingCategory>('reply');
  const [rules, setRules] = useState<TrainingRule[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<EditorState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const propertyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, p.name);
    return m;
  }, [properties]);

  const visibleRules = useMemo(
    () => rules.filter((r) => r.category === categoryFilter),
    [rules, categoryFilter],
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
      <CategoryTabs category={categoryFilter} onChange={setCategoryFilter} />
      <p className="-mt-1 text-xs text-muted-foreground">{CATEGORY_META[categoryFilter].blurb}</p>

      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-xs">
          {visibleRules.length} rule{visibleRules.length !== 1 ? 's' : ''}
        </Badge>
        <Button onClick={() => setEditor({ mode: 'create', category: categoryFilter })}>
          <Plus className="mr-2 h-4 w-4" />
          New rule
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visibleRules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            No {CATEGORY_META[categoryFilter].label.toLowerCase()} yet. Add your first procedure — e.g.
            “{CATEGORY_META[categoryFilter].placeholderTitle}”.
          </p>
          <Button onClick={() => setEditor({ mode: 'create', category: categoryFilter })}>
            <Plus className="mr-2 h-4 w-4" />
            Create first rule
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
  );

  const content = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg-soft)] text-[var(--accent-3)]">
          <GraduationCap className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Concierge Training</h1>
          <p className="text-sm text-muted-foreground">
            Teach the AI how to handle guest situations, then test how it replies.
          </p>
        </div>
      </header>

      <SectionTabs section={section} onChange={setSection} />

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {section === 'training' ? (
        trainingPanel
      ) : (
        <TestConsole properties={properties} loadingProperties={loading} />
      )}
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
  category,
  onChange,
}: {
  category: TrainingCategory;
  onChange: (c: TrainingCategory) => void;
}) {
  const items: { key: TrainingCategory; label: string }[] = [
    { key: 'reply', label: 'Reply rules' },
    { key: 'task', label: 'Task rules' },
  ];
  return (
    <div className="inline-flex gap-1 self-start rounded-lg border border-border bg-muted/40 p-1">
      {items.map((it) => {
        const active = category === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-[var(--accent-3)] text-white shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionTabs({
  section,
  onChange,
}: {
  section: Section;
  onChange: (s: Section) => void;
}) {
  const items: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'training', label: 'Training', icon: <GraduationCap className="h-3.5 w-3.5" /> },
    { key: 'test', label: 'Test', icon: <FlaskConical className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="inline-flex gap-1 self-start rounded-lg border border-border bg-muted/40 p-1">
      {items.map((it) => {
        const active = section === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-[var(--accent-3)] text-white shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

interface TestTurn {
  role: 'guest' | 'host';
  text: string;
}

type TestScenario = 'checked_in' | 'upcoming' | 'past' | 'inquiry';

const SCENARIO_OPTIONS: { value: TestScenario; label: string }[] = [
  { value: 'checked_in', label: 'Currently checked in' },
  { value: 'upcoming', label: 'Upcoming reservation' },
  { value: 'past', label: 'Past stay (checked out)' },
  { value: 'inquiry', label: 'Inquiry (not booked)' },
];

function TestConsole({
  properties,
  loadingProperties,
}: {
  properties: PropertyOption[];
  loadingProperties: boolean;
}) {
  const [propertyId, setPropertyId] = useState<string>('');
  const [guestName, setGuestName] = useState<string>('');
  const [scenario, setScenario] = useState<TestScenario>('checked_in');
  const [turns, setTurns] = useState<TestTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ready = propertyId.length > 0;

  // Changing the property or scenario changes the test identity mid-thread,
  // which would make an in-progress conversation incoherent — so reset it.
  const changeProperty = (v: string) => {
    setPropertyId(v);
    setTurns([]);
    setError(null);
  };
  const changeScenario = (v: TestScenario) => {
    setScenario(v);
    setTurns([]);
    setError(null);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const reset = () => {
    setTurns([]);
    setInput('');
    setError(null);
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !ready || sending) return;
    const nextTurns: TestTurn[] = [...turns, { role: 'guest', text }];
    setTurns(nextTurns);
    setInput('');
    setError(null);
    setSending(true);
    try {
      const res = await fetch('/api/concierge-training/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          guest_name: guestName.trim(),
          scenario,
          messages: nextTurns.map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to generate a reply');
      setTurns((prev) => [...prev, { role: 'host', text: typeof data.reply === 'string' ? data.reply : '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a reply');
    } finally {
      setSending(false);
    }
  }, [input, ready, sending, turns, propertyId, guestName, scenario]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Test identity controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Property</Label>
          <Select value={propertyId} onValueChange={changeProperty}>
            <SelectTrigger className="w-[200px]" disabled={loadingProperties}>
              <SelectValue placeholder={loadingProperties ? 'Loading…' : 'Select a property'} />
            </SelectTrigger>
            <SelectContent>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Guest status</Label>
          <Select value={scenario} onValueChange={(v) => changeScenario(v as TestScenario)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENARIO_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-guest" className="text-xs">Guest name</Label>
          <Input
            id="test-guest"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="e.g. Jordan"
            className="w-[150px]"
          />
        </div>
        {turns.length > 0 && (
          <Button variant="outline" size="sm" onClick={reset} className="ml-auto">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            New conversation
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Messages run through the live concierge exactly as a real guest at this property would — the AI
        doesn’t know it’s a test. Nothing here is saved or sent.
      </p>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex min-h-[280px] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4"
      >
        {turns.length === 0 && !sending ? (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            {ready
              ? 'Type a guest message below to see how the concierge replies.'
              : 'Select a property to start testing.'}
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === 'guest' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--accent-3)] px-3.5 py-2 text-sm text-white">
                  <p className="whitespace-pre-wrap break-words">{t.text}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start">
                <span className="mb-0.5 ml-1 text-[11px] font-medium text-muted-foreground">Concierge</span>
                <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-muted/50 px-3.5 py-2 text-sm text-foreground">
                  <p className="whitespace-pre-wrap break-words">{t.text}</p>
                </div>
              </div>
            ),
          )
        )}
        {sending && (
          <div className="flex flex-col items-start">
            <span className="mb-0.5 ml-1 text-[11px] font-medium text-muted-foreground">Concierge</span>
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-muted/50 px-3.5 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-2 py-2 focus-within:border-[var(--accent-3)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)]">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!ready || sending}
          placeholder={ready ? 'Message as the guest…' : 'Select a property first'}
          className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready || sending || !input.trim()}
          aria-label="Send test message"
          className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </button>
      </div>
    </div>
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
      if (!res.ok) throw new Error(data?.error || 'Failed to save rule');
      await onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>
            {category === 'task'
              ? 'A rule guiding when and how the AI drafts operational tasks from guest messages.'
              : 'A named procedure the AI follows when drafting guest replies for the selected properties.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Rule type</Label>
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
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
