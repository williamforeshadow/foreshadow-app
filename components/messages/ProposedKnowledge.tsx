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
  Eye,
  EyeOff,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import { TagChip, ContactTagChip } from '@/components/properties/cards/TagChip';
import type { AttributeTag, ContactTag } from '@/lib/propertyAttributes';

// Local mirror of the concierge's KnowledgeTarget (kept local so this client
// component never imports the server-only draftKnowledge module).
type RoomRef = { id: string | null; scope: 'interior' | 'exterior'; title: string | null };
export type KnowledgeTargetData =
  | { kind: 'room_note'; room: RoomRef; notes: string }
  | { kind: 'attribute'; room: RoomRef; attribute: { tags: AttributeTag[]; title: string; body: string | null } }
  | {
      kind: 'connectivity';
      fields: { wifi_ssid: string | null; wifi_password: string | null; wifi_router_location: string | null };
    }
  | {
      kind: 'contact';
      contact: {
        id?: string | null;
        tags: ContactTag[];
        name: string;
        role: string | null;
        phone: string | null;
        email: string | null;
        schedule: string | null;
        notes: string | null;
      };
    };

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

// Shared transparent-input styling for the connectivity/contact field editors —
// the same "reads like text" look as the attribute inputs.
const BUBBLE_INPUT =
  'w-full rounded bg-transparent px-0.5 text-[14px] leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-black/[0.03] dark:focus:bg-white/[0.04]';

function BubbleField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="px-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground/70">
        {label}
      </span>
      {children}
    </label>
  );
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
 * base, editable inline. Four shapes: an `attribute` (tags + title + body under a
 * room/area), a `room_note` (free text on a room/area), a `connectivity` (wifi
 * SSID/password/router), or a `contact` (a vendor/person). Accepting writes it via
 * the same path the Knowledge UI uses; the green/red pill chooses guest
 * visibility (defaults unlocked for room/wifi, locked for contacts). Once decided
 * it becomes an in-thread
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
  const isRoomNote = target?.kind === 'room_note';
  const isConnectivity = target?.kind === 'connectivity';
  const isContact = target?.kind === 'contact';
  const contactIsUpdate = target?.kind === 'contact' && !!target.contact.id;
  // Interior areas are "rooms"; exterior areas are "areas". Room labels only
  // apply to the room kinds — connectivity/contact are roomless.
  const scope =
    target && (target.kind === 'room_note' || target.kind === 'attribute')
      ? target.room.scope === 'exterior'
        ? 'exterior'
        : 'interior'
      : 'interior';
  const roomTitle =
    target && (target.kind === 'room_note' || target.kind === 'attribute')
      ? target.room.title
      : null;
  const noun = scope === 'exterior' ? 'Area' : 'Room';
  const noteKindLabel = scope === 'exterior' ? 'Area note' : 'Room note';

  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const justify = align === 'start' ? 'justify-start' : 'justify-end';

  // Inline-editable draft, seeded from the target.
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
  // Connectivity (wifi) draft.
  const [wifiSsid, setWifiSsid] = useState(
    target?.kind === 'connectivity' ? target.fields.wifi_ssid ?? '' : '',
  );
  const [wifiPassword, setWifiPassword] = useState(
    target?.kind === 'connectivity' ? target.fields.wifi_password ?? '' : '',
  );
  const [wifiRouter, setWifiRouter] = useState(
    target?.kind === 'connectivity' ? target.fields.wifi_router_location ?? '' : '',
  );
  const [showPwd, setShowPwd] = useState(false);
  // Contact (vendor) draft.
  const [cName, setCName] = useState(target?.kind === 'contact' ? target.contact.name : '');
  const [cRole, setCRole] = useState(target?.kind === 'contact' ? target.contact.role ?? '' : '');
  const [cPhone, setCPhone] = useState(target?.kind === 'contact' ? target.contact.phone ?? '' : '');
  const [cEmail, setCEmail] = useState(target?.kind === 'contact' ? target.contact.email ?? '' : '');
  const [cSchedule, setCSchedule] = useState(
    target?.kind === 'contact' ? target.contact.schedule ?? '' : '',
  );
  const [cNotes, setCNotes] = useState(target?.kind === 'contact' ? target.contact.notes ?? '' : '');
  const [contactTags, setContactTags] = useState<ContactTag[]>(
    target?.kind === 'contact' ? target.contact.tags : [],
  );
  // Visibility: room knowledge defaults Unlocked (usually guest-shareable);
  // connectivity/contact follow the concierge's suggested guest_visible (wifi
  // unlocked, a vendor/contact locked).
  const [unlocked, setUnlocked] = useState(
    isConnectivity || isContact ? proposal.guest_visible : true,
  );

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
      } else if (target?.kind === 'connectivity') {
        payload.wifi_ssid = wifiSsid;
        payload.wifi_password = wifiPassword;
        payload.wifi_router_location = wifiRouter;
      } else if (target?.kind === 'contact') {
        payload.name = cName;
        payload.role = cRole;
        payload.phone = cPhone;
        payload.email = cEmail;
        payload.schedule = cSchedule;
        payload.notes = cNotes;
        payload.tags = contactTags;
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
  }, [
    proposal.id,
    target,
    title,
    body,
    tags,
    notes,
    wifiSsid,
    wifiPassword,
    wifiRouter,
    cName,
    cRole,
    cPhone,
    cEmail,
    cSchedule,
    cNotes,
    contactTags,
    unlocked,
    onChanged,
    onAccept,
  ]);

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
    const knowledgeSlug =
      target?.kind === 'connectivity'
        ? 'connectivity'
        : target?.kind === 'contact'
          ? 'vendors'
          : scope;
    const href = propertyId ? `/properties/${propertyId}/knowledge/${knowledgeSlug}` : null;
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
          {isAttribute ? (
            <TagChip value={tags} onChange={setTags} />
          ) : isContact ? (
            <ContactTagChip value={contactTags} onChange={setContactTags} />
          ) : null}
        </div>

        {/* Where it lands — the destination section (room name for room kinds). */}
        <div className="px-0.5 text-[12px] italic text-muted-foreground">
          {isConnectivity
            ? 'Wi-Fi · Connectivity'
            : isContact
              ? contactIsUpdate
                ? 'Update · Vendors & Contacts'
                : 'Vendors & Contacts'
              : `${roomTitle || noun}${isRoomNote ? ` · ${noteKindLabel}` : ''}`}
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
        ) : isRoomNote ? (
          <AutoTextarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`${noun} note`}
            rows={1}
            className="w-full resize-none rounded bg-transparent px-0.5 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-black/[0.03] dark:focus:bg-white/[0.04]"
          />
        ) : isConnectivity ? (
          <div className="flex flex-col gap-2">
            <BubbleField label="Network (SSID)">
              <input
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                placeholder="Network name"
                className={BUBBLE_INPUT}
              />
            </BubbleField>
            <BubbleField label="Password">
              <div className="flex items-center gap-1">
                <input
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Password"
                  className={BUBBLE_INPUT}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  title={showPwd ? 'Hide' : 'Show'}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPwd ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </div>
            </BubbleField>
            <BubbleField label="Router location">
              <input
                value={wifiRouter}
                onChange={(e) => setWifiRouter(e.target.value)}
                placeholder="Hallway closet, etc."
                className={BUBBLE_INPUT}
              />
            </BubbleField>
          </div>
        ) : isContact ? (
          <div className="flex flex-col gap-2">
            <input
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="Name (required)"
              className="w-full rounded bg-transparent px-0.5 text-[15px] font-semibold leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-black/[0.03] dark:focus:bg-white/[0.04]"
            />
            <BubbleField label="Role">
              <input
                value={cRole}
                onChange={(e) => setCRole(e.target.value)}
                placeholder="e.g. Lead cleaner"
                className={BUBBLE_INPUT}
              />
            </BubbleField>
            <div className="grid grid-cols-2 gap-2">
              <BubbleField label="Phone">
                <input
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  type="tel"
                  placeholder="Phone"
                  className={BUBBLE_INPUT}
                />
              </BubbleField>
              <BubbleField label="Email">
                <input
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  type="email"
                  placeholder="Email"
                  className={BUBBLE_INPUT}
                />
              </BubbleField>
            </div>
            <BubbleField label="Schedule">
              <input
                value={cSchedule}
                onChange={(e) => setCSchedule(e.target.value)}
                placeholder="e.g. Every Friday 10am"
                className={BUBBLE_INPUT}
              />
            </BubbleField>
            <BubbleField label="Notes">
              <AutoTextarea
                value={cNotes}
                onChange={(e) => setCNotes(e.target.value)}
                placeholder="Internal notes"
                rows={1}
                className={`${BUBBLE_INPUT} resize-none`}
              />
            </BubbleField>
          </div>
        ) : null}

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
              disabled={
                busy !== null ||
                (isAttribute && title.trim() === '') ||
                (isContact && cName.trim() === '') ||
                (isConnectivity && !wifiSsid.trim() && !wifiPassword.trim() && !wifiRouter.trim())
              }
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
