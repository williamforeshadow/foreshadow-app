'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  BookPlus,
  Check,
  X,
  Loader2,
  AlertCircle,
  ArrowUpRight,
  Unlock,
  Lock,
  HelpCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import { TagChip, TagChips } from '@/components/properties/cards/TagChip';
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
  status?: 'pending' | 'accepted';
  decided_by_name?: string | null;
  decided_at?: string | null;
  resulting_resource_type?: string | null;
  resulting_resource_id?: string | null;
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

function roomLabel(room: RoomRef | undefined): string {
  if (!room) return 'Property';
  const where = room.scope === 'exterior' ? 'Exterior' : 'Interior';
  return `${room.title || 'Room'} · ${where}`;
}

const VISIBILITY_HELP =
  'Unlocked = the concierge can share this with guests. Locked = internal only — used by staff/AI but never told to a guest.';

/**
 * A concierge-proposed knowledge addition, rendered beneath the message that
 * prompted it. Mirrors ProposedTask: a right-aligned bubble that previews the
 * proposal as it will appear in the property's knowledge base, editable inline.
 * Two shapes: an `attribute` (tags + title + body under a room) or a `room_note`
 * (free text on a room). Accepting writes it via the same path the Knowledge UI
 * uses; the green/red pill chooses guest visibility (unlocked by default). Once
 * accepted it becomes an in-thread "approved by … " tombstone.
 */
export function ProposedKnowledge({
  proposal,
  propertyId = null,
  onChanged,
}: {
  proposal: ProposedKnowledgeData;
  propertyId?: string | null;
  onChanged?: () => void;
}) {
  const target = proposal.target;
  const isAttribute = target?.kind === 'attribute';

  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [proposal.id, target, title, body, tags, notes, unlocked, onChanged]);

  const dismiss = useCallback(async () => {
    setBusy('dismiss');
    setError(null);
    try {
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
  }, [proposal.id, onChanged]);

  // ---- Accepted tombstone ------------------------------------------------
  if (proposal.status === 'accepted') {
    const when = formatDecidedAt(proposal.decided_at);
    const who = proposal.decided_by_name || 'someone';
    const scope = target?.room?.scope === 'exterior' ? 'exterior' : 'interior';
    const href = propertyId ? `/properties/${propertyId}/knowledge/${scope}` : null;
    return (
      <div className="mt-4 flex justify-end">
        <div className="msg-in flex w-full max-w-[20rem] items-center gap-2 rounded-2xl border border-[var(--accent-3)]/20 px-3 py-2 text-[12px] text-muted-foreground dark:border-[var(--accent-1)]/20">
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
          <span className="min-w-0 flex-1">
            Knowledge approved by{' '}
            <span className="font-medium text-foreground">{who}</span>
            {when ? ` · ${when}` : ''}
          </span>
          {href ? (
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-[var(--accent-3)] hover:underline dark:text-[var(--accent-1)]"
            >
              Open
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  // ---- Pending: adaptive, inline-editable preview ------------------------
  return (
    <div className="mt-4 flex justify-end">
      <div className="msg-in flex w-full max-w-[20rem] flex-col gap-2 rounded-2xl border border-[var(--accent-3)]/30 p-2.5 dark:border-[var(--accent-1)]/25">
        {/* Provenance + where */}
        <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)]">
          <BookPlus className="h-3.5 w-3.5" aria-hidden />
          <span>Proposed knowledge</span>
        </div>
        <div className="px-0.5 text-[11px] text-muted-foreground">
          {roomLabel(target?.room)}
          {target?.kind === 'room_note' ? ' · Room note' : ''}
        </div>

        {!target ? (
          // Legacy fallback (no structured target): show the summary read-only.
          <p className="whitespace-pre-wrap break-words px-0.5 text-[13px] leading-relaxed text-foreground">
            {proposal.summary}
          </p>
        ) : isAttribute ? (
          <div className="flex flex-col gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-md border border-[var(--accent-3)]/20 bg-white/60 px-2 py-1.5 text-[13px] font-medium text-foreground outline-none focus:border-[var(--accent-3)] dark:border-[var(--accent-1)]/20 dark:bg-white/[0.04]"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <TagChips tags={tags} />
              <TagChip value={tags} onChange={setTags} />
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Details (optional)"
              rows={2}
              className="w-full resize-none rounded-md border border-[var(--accent-3)]/20 bg-white/60 px-2 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-[var(--accent-3)] dark:border-[var(--accent-1)]/20 dark:bg-white/[0.04]"
            />
          </div>
        ) : (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Room note"
            rows={2}
            className="w-full resize-none rounded-md border border-[var(--accent-3)]/20 bg-white/60 px-2 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-[var(--accent-3)] dark:border-[var(--accent-1)]/20 dark:bg-white/[0.04]"
          />
        )}

        {error ? (
          <div className="flex items-start gap-2 px-0.5 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Visibility pill + help, then actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setUnlocked((v) => !v)}
              disabled={busy !== null}
              aria-pressed={unlocked}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                unlocked
                  ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--accent-3)]/10 hover:text-foreground disabled:opacity-40 dark:hover:bg-[var(--accent-1)]/15"
            >
              {busy === 'dismiss' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden />
              )}
              Dismiss
            </button>
            <button
              type="button"
              onClick={accept}
              disabled={busy !== null || (isAttribute && title.trim() === '')}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-3)] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === 'accept' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <BookPlus className="h-3.5 w-3.5" aria-hidden />
              )}
              Add to knowledge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
