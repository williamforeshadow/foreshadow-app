'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  X,
  Plus,
  Loader2,
  AlertCircle,
  ArrowUpRight,
  Unlock,
  Lock,
  HelpCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import { TagChip } from '@/components/properties/cards/TagChip';
import type { AttributeTag } from '@/lib/propertyAttributes';

// Local mirror of the concierge's KnowledgeTarget (kept local so this client
// component never imports the server-only draftKnowledge module).
type RoomRef = { id: string | null; scope: 'interior' | 'exterior'; title: string | null };
export type KnowledgeTargetData =
  | { kind: 'room_note'; room: RoomRef; notes: string }
  | { kind: 'attribute'; room: RoomRef; attribute: { tags: AttributeTag[]; title: string; body: string | null } };

export interface ProposedKnowledgeData {
  id: string;
  summary: string;
  guest_visible: boolean;
  /** The message that triggered the draft; the bubble anchors here. */
  triggering_message_id: string | null;
  /** Structured target (room_note | attribute). Null only for legacy rows. */
  target: KnowledgeTargetData | null;
  status?: 'pending' | 'accepted' | 'dismissed';
  decided_by_name?: string | null;
  decided_at?: string | null;
  resulting_resource_type?: string | null;
  resulting_resource_id?: string | null;
}

// The Properties sidebar icon (a house) — proposed knowledge lands in Property
// Knowledge, so it carries the same mark.
function HouseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

// Textarea that grows to fit its content so the full proposal is visible without
// an inner scrollbar.
function AutoTextarea({
  value,
  className,
  ...rest
}: React.ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} value={value} className={className} {...rest} />;
}

function formatDecidedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const VISIBILITY_HELP =
  'Unlocked = the concierge can share this with guests. Locked = internal only — used by staff/AI but never told to a guest.';

/**
 * A concierge-proposed knowledge addition, rendered beneath the message that
 * prompted it. A right-aligned (or, in the test console, left-aligned) cyan
 * bubble previewing the proposal as it will appear in the property's knowledge
 * base, editable inline. Two shapes: an `attribute` (tags + title + body under a
 * room/area) or a `room_note` (free text on a room/area). Accepting writes it via
 * the same path the Knowledge UI uses; the green/red pill chooses guest
 * visibility (unlocked by default). Once decided it becomes an in-thread
 * "approved by … " / "dismissed by … " tombstone.
 */
export function ProposedKnowledge({
  proposal,
  propertyId = null,
  align = 'end',
  onChanged,
  onAccept,
  onDismiss,
}: {
  proposal: ProposedKnowledgeData;
  propertyId?: string | null;
  /** Which side the bubble sits on. 'end' (right) in the inbox; 'start' (left)
   *  in the concierge test console, where the AI sits on the left. */
  align?: 'start' | 'end';
  onChanged?: () => void;
  /** Test-mode override: replaces the persisted accept (no DB write). */
  onAccept?: () => void | Promise<void>;
  /** Test-mode override: replaces the persisted dismiss (no DB write). */
  onDismiss?: () => void | Promise<void>;
}) {
  const target = proposal.target;
  const isAttribute = target?.kind === 'attribute';
  // Interior areas are "rooms"; exterior areas are "areas" (see the Property
  // Knowledge interior/exterior tabs). Drive every label off that distinction.
  const scope = target?.room?.scope === 'exterior' ? 'exterior' : 'interior';
  const noun = scope === 'exterior' ? 'Area' : 'Room';
  const noteKindLabel = scope === 'exterior' ? 'Area note' : 'Room note';

  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const justify = align === 'start' ? 'justify-start' : 'justify-end';

  // Inline-editable draft, seeded from the target. Guest-visible defaults to
  // UNLOCKED for every proposal (the reviewer can lock it before accepting).
  const [title, setTitle] = useState(
    target?.kind === 'attribute' ? target.attribute.title : '',
  );
  const [body, setBody] = useState(
    target?.kind === 'attribute' ? target.attribute.body ?? '' : '',
  );
  const [tags, setTags] = useState<AttributeTag[]>(
    target?.kind === 'attribute' ? target.attribute.tags : [],
  );
  const [notes, setNotes] = useState(
    target?.kind === 'room_note' ? target.notes : '',
  );
  const [unlocked, setUnlocked] = useState(true);

  const accept = useCallback(async () => {
    setBusy('accept');
    setError(null);
    try {
      if (onAccept) {
        await onAccept();
        return;
      }
      const payload: Record<string, unknown> = { guest_visible: unlocked };
      if (target?.kind === 'attribute') {
        payload.title = title;
        payload.body = body;
        payload.tags = tags;
      } else if (target?.kind === 'room_note') {
        payload.notes = notes;
      }
      const res = await apiFetch(`/api/proposed-knowledge/${proposal.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not save to knowledge.');
        return;
      }
      onChanged?.();
    } catch {
      setError('Could not save to knowledge.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, target, title, body, tags, notes, unlocked, onChanged, onAccept]);

  const dismiss = useCallback(async () => {
    setBusy('dismiss');
    setError(null);
    try {
      if (onDismiss) {
        await onDismiss();
        return;
      }
      const res = await apiFetch(`/api/proposed-knowledge/${proposal.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Could not dismiss.');
        return;
      }
      onChanged?.();
    } catch {
      setError('Could not dismiss.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, onChanged, onDismiss]);

  // ---- Accepted tombstone ------------------------------------------------
  if (proposal.status === 'accepted') {
    const when = formatDecidedAt(proposal.decided_at);
    const who = proposal.decided_by_name || 'someone';
    const href = propertyId ? `/properties/${propertyId}/knowledge/${scope}` : null;
    return (
      <div className={`mt-4 flex ${justify}`}>
        <div className="msg-in flex w-full max-w-[20rem] items-center gap-2 rounded-2xl border border-cyan-500/25 px-3 py-2 text-[12px] text-muted-foreground dark:border-cyan-400/25">
          <Check className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
          <span className="min-w-0 flex-1">
            Knowledge approved by{' '}
            <span className="font-medium text-foreground">{who}</span>
            {when ? ` · ${when}` : ''}
          </span>
          {href ? (
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-cyan-600 hover:underline dark:text-cyan-400"
            >
              Open
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  // ---- Dismissed tombstone -----------------------------------------------
  if (proposal.status === 'dismissed') {
    const when = formatDecidedAt(proposal.decided_at);
    const who = proposal.decided_by_name || 'someone';
    return (
      <div className={`mt-4 flex ${justify}`}>
        <div className="msg-in flex w-full max-w-[20rem] items-center gap-2 rounded-2xl border border-black/[0.08] px-3 py-2 text-[12px] text-muted-foreground dark:border-white/[0.08]">
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            Knowledge proposal dismissed by{' '}
            <span className="font-medium text-foreground">{who}</span>
            {when ? ` · ${when}` : ''}
          </span>
        </div>
      </div>
    );
  }

  // ---- Pending: adaptive, inline-editable preview ------------------------
  return (
    <div className={`mt-4 flex ${justify}`}>
      <div className="msg-in glass-card glass-sheen relative flex w-full max-w-[20rem] flex-col gap-2 rounded-2xl border bg-[var(--proposal-knowledge-bg)] border-[var(--proposal-knowledge-border)] p-2.5">
        {/* Provenance (left) + collapsed tags (right) */}
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-600 dark:text-cyan-400">
            <HouseIcon className="h-3.5 w-3.5" />
            <span>Proposed Knowledge</span>
          </div>
          {isAttribute ? <TagChip value={tags} onChange={setTags} /> : null}
        </div>

        {/* Where it lands — the room/area name (note kind appended for notes). */}
        <div className="px-0.5 text-[12px] italic text-muted-foreground">
          {target?.room?.title || noun}
          {target?.kind === 'room_note' ? ` · ${noteKindLabel}` : ''}
        </div>

        {!target ? (
          // Legacy fallback (no structured target): show the summary read-only.
          <p className="whitespace-pre-wrap break-words px-0.5 text-[13px] leading-relaxed text-foreground">
            {proposal.summary}
          </p>
        ) : isAttribute ? (
          // No visible inputs — the draft reads like text (à la the proposed
          // reply), title bumped up and body smaller, but both stay editable.
          <div className="flex flex-col gap-1.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded bg-transparent px-0.5 text-[15px] font-semibold leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-black/[0.03] dark:focus:bg-white/[0.04]"
            />
            <AutoTextarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add details"
              rows={1}
              className="w-full resize-none rounded bg-transparent px-0.5 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-black/[0.03] dark:focus:bg-white/[0.04]"
            />
          </div>
        ) : (
          <AutoTextarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`${noun} note`}
            rows={1}
            className="w-full resize-none rounded bg-transparent px-0.5 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-black/[0.03] dark:focus:bg-white/[0.04]"
          />
        )}

        {error ? (
          <div className="flex items-start gap-2 px-0.5 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Visibility pill + help (left); dismiss / add actions (right). */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setUnlocked((v) => !v)}
              disabled={busy !== null}
              aria-pressed={unlocked}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                unlocked
                  ? 'bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-300'
                  : 'bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300'
              }`}
            >
              {unlocked ? (
                <>
                  <Unlock className="h-3 w-3" aria-hidden /> Unlocked
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3" aria-hidden /> Locked
                </>
              )}
            </button>
            <span
              title={VISIBILITY_HELP}
              className="inline-flex cursor-help text-muted-foreground/70 hover:text-muted-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{VISIBILITY_HELP}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={dismiss}
              disabled={busy !== null}
              title="Dismiss"
              aria-label="Dismiss"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground disabled:opacity-40 dark:hover:bg-white/[0.06]"
            >
              {busy === 'dismiss' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <X className="h-4 w-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={accept}
              disabled={busy !== null || (isAttribute && title.trim() === '')}
              title="Add to knowledge"
              aria-label="Add to knowledge"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600 text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === 'accept' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
