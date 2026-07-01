'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

// "Turn into training" — promote selected conversation messages into a concierge
// training block. The AI structures the selected transcript into a draft block
// (title, instructions, tier, category) with the transcript as a worked example;
// the operator reviews, then saves it as a NEW block or appends the example to an
// EXISTING block of the same category. This component only orchestrates the
// existing endpoints — it holds no business logic of its own.

type Tier = 'always' | 'situational';
type Category = 'reply' | 'task';

interface StructuredDraft {
  title: string;
  instructions: string;
  tier: Tier;
  category: Category;
  example: { label: string; transcript: string } | null;
}

interface TrainingBlockOption {
  id: string;
  title: string;
  category: Category;
  applies_to_all: boolean;
  property_ids: string[];
}

export function TurnIntoTrainingDialog({
  conversationId,
  messageIds,
  propertyId,
  propertyName,
  onClose,
  onCreated,
}: {
  conversationId: string;
  messageIds: string[];
  propertyId?: string | null;
  propertyName?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [tier, setTier] = useState<Tier>('situational');
  const [category, setCategory] = useState<Category>('reply');
  const [exampleLabel, setExampleLabel] = useState('');
  const [transcript, setTranscript] = useState('');
  const [editingTranscript, setEditingTranscript] = useState(false);

  const [mode, setMode] = useState<'new' | 'existing' | null>(null);
  const [scope, setScope] = useState<'property' | 'all'>(propertyId ? 'property' : 'all');
  const [blocks, setBlocks] = useState<TrainingBlockOption[]>([]);
  const [targetBlockId, setTargetBlockId] = useState<string>('');
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Structure the selected transcript into a draft block on open.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/concierge-training/structure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'conversation',
            conversation_id: conversationId,
            message_ids: messageIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to structure the conversation');
        if (!active) return;
        const draft = data.draft as StructuredDraft;
        setTitle(draft.title ?? '');
        setInstructions(draft.instructions ?? '');
        setTier(draft.tier === 'always' ? 'always' : 'situational');
        setCategory(draft.category === 'task' ? 'task' : 'reply');
        setExampleLabel(draft.example?.label ?? '');
        setTranscript(draft.example?.transcript ?? '');
        setPhase('ready');
      } catch (err) {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to structure the conversation');
        setPhase('error');
      }
    })();
    return () => {
      active = false;
    };
    // Structure ONCE for the selection the dialog opened with. messageIds is a
    // fresh array on every parent render (the messages list polls every 60s), so
    // depending on it would re-run this effect and clobber the operator's edits.
    // The selection can't change while the dialog is open, so mount-once is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load existing blocks (of the same category) when switching to append mode.
  useEffect(() => {
    if (mode !== 'existing' || blocks.length > 0) return;
    let active = true;
    (async () => {
      try {
        // Blocks (for the list) + properties (to resolve names for the scope pill).
        const [blocksRes, propsRes] = await Promise.all([
          fetch('/api/concierge-training'),
          fetch('/api/properties'),
        ]);
        const data = await blocksRes.json();
        if (!blocksRes.ok) throw new Error(data?.error || 'Failed to load training blocks');
        const propsData = await propsRes.json().catch(() => ({}));
        if (!active) return;

        const names: Record<string, string> = {};
        if (Array.isArray(propsData?.properties)) {
          for (const p of propsData.properties as Array<{ id: string; name: string }>) {
            names[p.id] = p.name;
          }
        }
        setPropertyNames(names);

        const all = (Array.isArray(data.rules) ? data.rules : []) as Array<{
          id: string;
          title: string;
          category: Category;
          applies_to_all?: boolean;
          property_ids?: string[];
        }>;
        setBlocks(
          all
            .filter((b) => b.category === category)
            .map((b) => ({
              id: b.id,
              title: b.title,
              category: b.category,
              applies_to_all: !!b.applies_to_all,
              property_ids: Array.isArray(b.property_ids) ? b.property_ids : [],
            })),
        );
      } catch (err) {
        if (active) setFormError(err instanceof Error ? err.message : 'Failed to load training blocks');
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, category, blocks.length]);

  const canSave =
    phase === 'ready' &&
    transcript.trim().length > 0 &&
    mode !== null &&
    (mode === 'new' ? title.trim().length > 0 : !!targetBlockId);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const example = {
      label: exampleLabel.trim() || null,
      transcript: transcript.trim(),
      source_conversation_id: conversationId,
    };
    try {
      if (mode === 'new') {
        const res = await fetch('/api/concierge-training', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            instructions: instructions.trim(),
            category,
            tier,
            applies_to_all: scope === 'all',
            is_active: true,
            property_ids: scope === 'all' || !propertyId ? [] : [propertyId],
            examples: [example],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to create training block');
      } else {
        const res = await fetch(`/api/concierge-training/${targetBlockId}/examples`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(example),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to add example');
      }
      onCreated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="flex h-[min(90svh,640px)] flex-col gap-0 overflow-hidden border-[var(--surface-elevated-line)] bg-[var(--surface-elevated)] p-0 shadow-[var(--glass-shadow)] sm:max-w-4xl"
      >
        <div
          className="liquid-glass-surface pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
          aria-hidden
        />
        <DialogHeader className="border-b border-border px-7 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-[var(--accent-3)]" />
            Turn into training
          </DialogTitle>
        </DialogHeader>

        {phase === 'loading' ? (
          <div className="flex flex-1 items-center justify-center px-7 text-sm text-muted-foreground">
            Reading the selected messages…
          </div>
        ) : phase === 'error' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-7 text-center">
            <p className="text-sm text-foreground">Couldn’t structure these messages.</p>
            <p className="max-w-sm text-xs text-muted-foreground">{loadError}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-7 py-5 overlay-scrollbar">
            {/* The reference exchange at the TOP — label (title) above the
                screenplay-style transcript; "Edit" drops to a raw textarea. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Add Messaging Example for AI&apos;s Reference
                  </label>
                  <InfoTooltip text="Add this message exchange as an example for the Concierge Agent to reference when drafting replies." />
                </div>
                <button
                  type="button"
                  onClick={() => setEditingTranscript((v) => !v)}
                  className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {editingTranscript ? 'Done' : 'Edit'}
                </button>
              </div>
              <Input
                value={exampleLabel}
                onChange={(e) => setExampleLabel(e.target.value)}
                placeholder="Label (optional) — what this example shows"
                className="h-9 text-sm"
              />
              {editingTranscript ? (
                <ExampleTranscriptField value={transcript} onChange={setTranscript} autoFocus />
              ) : (
                <TranscriptScript transcript={transcript} />
              )}
            </div>

            {/* Destination at the BOTTOM — centered prompt + centered pill toggle;
                nothing shows below until a mode is chosen. */}
            <div className="space-y-5 border-t border-border pt-6">
              <p className="text-center text-sm font-medium text-foreground">
                Would you like to create a new training block or add this reference exchange to an
                existing training block?
              </p>
              <div className="flex justify-center">
                <div className="msg-well inline-flex gap-1 rounded-full p-1">
                  {(['new', 'existing'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      className={cn(
                        'rounded-full px-3.5 py-1 text-xs font-medium transition-colors',
                        mode === m
                          ? 'bg-[var(--accent-3)] text-white'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m === 'new' ? 'New block' : 'Add to existing'}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'new' ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Title</label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Title"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Instructions
                      <span className="ml-1 font-normal">· the general rule this example shows</span>
                    </label>
                    <Textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="The rule the Agent should follow…"
                      className="min-h-[6rem] resize-none text-sm leading-relaxed"
                    />
                  </div>

                  {/* Tier + scope pills */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="msg-well inline-flex gap-1 rounded-full p-1">
                      {(['always', 'situational'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTier(t)}
                          aria-pressed={tier === t}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            tier === t
                              ? 'bg-[var(--accent-3)] text-white'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <Layers className="h-3 w-3" />
                          {t === 'always' ? 'Always in context' : 'Tool'}
                        </button>
                      ))}
                    </div>

                    {propertyId ? (
                      <div className="msg-well inline-flex gap-1 rounded-full p-1">
                        {(['property', 'all'] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setScope(s)}
                            aria-pressed={scope === s}
                            className={cn(
                              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                              scope === s
                                ? 'bg-[var(--accent-3)] text-white'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {s === 'property' ? propertyName || 'This property' : 'All properties'}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : mode === 'existing' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Add this example to…
                  </label>
                  {blocks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No existing {category} blocks. Switch to “New block”.
                    </p>
                  ) : (
                    <div className="msg-well max-h-48 overflow-y-auto rounded-xl p-1 overlay-scrollbar">
                      {blocks.map((b) => {
                        const selected = targetBlockId === b.id;
                        const count = b.property_ids.length;
                        return (
                          <div
                            key={b.id}
                            className={cn(
                              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                              selected
                                ? 'bg-[var(--accent-3)]/[0.12]'
                                : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]',
                            )}
                          >
                            {/* Click to select — click again to deselect. */}
                            <button
                              type="button"
                              onClick={() => setTargetBlockId((cur) => (cur === b.id ? '' : b.id))}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <span
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0 rounded-full border',
                                  selected
                                    ? 'border-[var(--accent-3)] bg-[var(--accent-3)]'
                                    : 'border-muted-foreground/40',
                                )}
                              />
                              <span
                                className={cn(
                                  'truncate',
                                  selected ? 'font-medium text-foreground' : 'text-muted-foreground',
                                )}
                              >
                                {b.title}
                              </span>
                            </button>

                            {/* Scope pill — read-only. "All properties", or a count
                                that opens a view-only list of the property names. */}
                            {b.applies_to_all ? (
                              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                All properties
                              </span>
                            ) : (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                                  >
                                    {count} {count === 1 ? 'property' : 'properties'}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="end"
                                  sideOffset={6}
                                  collisionPadding={12}
                                  className="max-h-60 w-56 overflow-y-auto rounded-lg border border-border p-1 overlay-scrollbar"
                                >
                                  {count === 0 ? (
                                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                      No properties assigned.
                                    </p>
                                  ) : (
                                    b.property_ids.map((pid) => (
                                      <p
                                        key={pid}
                                        className="truncate px-2 py-1.5 text-sm text-foreground"
                                      >
                                        {propertyNames[pid] ?? 'Unknown property'}
                                      </p>
                                    ))
                                  )}
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {formError && (
          <p className="px-7 pt-2 text-sm text-red-600 dark:text-red-400">{formError}</p>
        )}

        <DialogFooter className="border-t border-border px-7 py-4">
          <Button variant="outline" className="rounded-full" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : mode === 'existing' ? 'Add to block' : 'Create block'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
