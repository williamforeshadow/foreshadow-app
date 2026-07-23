'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { MessagesSquare, AlertCircle, Clock, GraduationCap, Check, X } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { MessageComposer } from '@/components/messages/MessageComposer';
import { ProposedReply } from '@/components/messages/ProposedReply';
import { ProposedTask, type ProposedTaskData } from '@/components/messages/ProposedTask';
import { ProposedKnowledge, type ProposedKnowledgeData } from '@/components/messages/ProposedKnowledge';
import { TurnIntoTrainingDialog } from '@/components/messages/TurnIntoTrainingDialog';
import { MessageAttachments } from '@/components/messages/MessageAttachments';
import { canonicalChannelLabel } from '@/lib/bookingChannel';
import type { ConciergeSourcesRecord } from '@/lib/conciergeSources';
import type { GuestMessageRecord } from '@/lib/messages';

/**
 * The full conversation as chat bubbles (guest left, host right). Used as the
 * center pane on desktop and the full-screen detail on mobile. Read-only in v1.
 *
 * Messages are grouped by calendar day (with a day separator) and consecutive
 * messages from the same side are visually clustered: the avatar and timestamp
 * print once per run so a back-and-forth reads as a conversation, not a list.
 */

function whenOf(m: GuestMessageRecord): string {
  return m.sent_at ?? m.created_at ?? '';
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A message only counts as a scheduled Hostaway automation when it's genuinely
// in the future by more than this slack. The buffer absorbs the seconds of clock
// skew between Hostaway's server (which stamps sent_at) and the browser clock, so
// a reply you just sent — or one synced in from the Hostaway app — isn't briefly
// mis-rendered as "Scheduled" while the two clocks disagree. Real automations are
// scheduled minutes-to-hours out, well past this threshold.
const SCHEDULED_SKEW_MS = 30_000;

export function ConversationThread({
  messages,
  conversationId,
  guestName,
  propertyName,
  propertyId,
  channel,
  loading,
  error,
  onRetry,
  showHeader = true,
  actions,
  proposedReply = null,
  proposedReplySource = null,
  proposedReplySources = null,
  proposedReplyAnswersMessageId = null,
  proposedReplyDeclinedMessageId = null,
  replyProposalEnabled = true,
  conciergeEnabled = true,
  onSendMessage,
  onProposedReplyChange,
  proposedTasks = [],
  onProposedTaskChange,
  onOpenTaskEditor,
  proposedKnowledge = [],
  onProposedKnowledgeChange,
  hideInlineSelectionEntry = false,
  startSelectionSignal,
}: {
  messages: GuestMessageRecord[];
  conversationId?: string;
  guestName?: string | null;
  propertyName?: string | null;
  propertyId?: string | null;
  channel?: string | null;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  showHeader?: boolean;
  actions?: React.ReactNode;
  /** The conversation's persisted proposed reply (read, not regenerated here). */
  proposedReply?: string | null;
  proposedReplySource?: 'auto' | 'assistant' | null;
  /** What grounded the draft (training + tool calls); null on pre-feature drafts. */
  proposedReplySources?: ConciergeSourcesRecord | null;
  proposedReplyAnswersMessageId?: string | null;
  /** guest_messages.id the sensitivity gate ruled needs no reply, if any. */
  proposedReplyDeclinedMessageId?: string | null;
  /** The org's autonomous reply-drafting master switch. Off ⇒ no unprompted
   *  proposal bubble; the composer's Sparkles stays as the manual way in. */
  replyProposalEnabled?: boolean;
  /** Per-conversation concierge switch. Off ⇒ no proposal bubble at all (the
   *  operator is running this thread by hand). */
  conciergeEnabled?: boolean;
  /** Send a host reply through the PMS. Resolves true on success (the composer /
   *  proposed reply then clears). Absent ⇒ send controls stay inert. */
  onSendMessage?: (text: string) => Promise<boolean>;
  onProposedReplyChange?: () => void;
  /** The conversation's pending proposed tasks (multiple can coexist). */
  proposedTasks?: ProposedTaskData[];
  onProposedTaskChange?: () => void;
  /** Open the full task editor for a proposal (rendered at the page level). */
  onOpenTaskEditor?: (proposal: ProposedTaskData) => void;
  /** The conversation's pending proposed knowledge additions. */
  proposedKnowledge?: ProposedKnowledgeData[];
  onProposedKnowledgeChange?: () => void;
  /** Mobile: entry to "turn into training" selection is driven externally (the
   *  top-bar ••• menu), so the thread should not render its own inline grad-cap
   *  entry. The confirm/cancel controls still appear while selecting. */
  hideInlineSelectionEntry?: boolean;
  /** Bump to enter selection mode from outside (mobile ••• menu). Its initial
   *  value is ignored — only a change starts a selection. */
  startSelectionSignal?: number;
}) {
  // "Now" for the scheduled-vs-sent check. Computed fresh every render (NOT
  // frozen at mount) so a message sent or synced after the thread was opened is
  // compared against the current time, not a stale mount-time value — otherwise
  // its real timestamp reads as "in the future" and it mis-renders as a
  // "Scheduled" automation until a manual refresh. The interval below forces a
  // periodic re-render so a genuinely-scheduled message flips to sent on its own
  // once its time passes, even with no other activity.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = Date.now();
  const [composerText, setComposerText] = useState('');
  const [focusSignal, setFocusSignal] = useState(0);
  const [prevConvId, setPrevConvId] = useState(conversationId);
  const [prevSelSignal, setPrevSelSignal] = useState(startSelectionSignal);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // "Turn into training": pick one or more messages, then promote them into a
  // concierge training block via TurnIntoTrainingDialog.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Reset per-conversation UI when the open conversation changes (render-time
  // reset — React's recommended pattern, avoids a setState-in-effect).
  if (conversationId !== prevConvId) {
    setPrevConvId(conversationId);
    setComposerText('');
    setSelectionMode(false);
    setSelectedIds(new Set());
    setTurnIntoOpen(false);
  }

  // External request (mobile ••• menu) to enter "turn into training" selection:
  // only a *change* to the signal starts it, so the initial value is ignored and
  // the thread never opens in selection mode. Render-time adjustment (React's
  // recommended pattern) rather than a setState-in-effect.
  if (startSelectionSignal !== prevSelSignal) {
    setPrevSelSignal(startSelectionSignal);
    if (startSelectionSignal !== undefined) setSelectionMode(true);
  }

  // The latest actually-sent message (future-dated host automations don't count).
  // When it's from the guest, the conversation is awaiting a host reply — that's
  // where the persisted proposed reply is anchored.
  const sentMessages = messages.filter(
    (m) =>
      !(
        m.direction === 'outbound' &&
        m.sent_at &&
        new Date(m.sent_at).getTime() > nowMs + SCHEDULED_SKEW_MS
      ),
  );
  const lastSent = sentMessages.length ? sentMessages[sentMessages.length - 1] : undefined;
  const awaitingReply = lastSent?.direction === 'inbound';
  const lastInboundId = awaitingReply ? lastSent!.id : null;
  // The stored draft is stale if it was written against an older message.
  const proposalStale =
    !!proposedReply && !!lastInboundId && proposedReplyAnswersMessageId !== lastInboundId;
  // The gate ruled the latest guest message doesn't warrant a reply of its own.
  const proposalDeclined = !!lastInboundId && proposedReplyDeclinedMessageId === lastInboundId;
  // Render the proposal at all? With the master switch off and nothing drafted,
  // there's no proposal to make and none coming — showing the bubble would just
  // advertise a capability this org turned off. A stored draft always shows.
  // The per-conversation switch is absolute: off ⇒ no bubble even if a draft
  // lingered (the status route clears it, but gate here too so it never flashes).
  const showProposedReply = conciergeEnabled && (replyProposalEnabled || !!proposedReply);

  // Each proposed task anchors to the message that triggered it — NOT the latest
  // inbound — so it persists until a human accepts or dismisses it, even after a
  // reply lands (from the app, a PMS, or another channel), and multiple distinct
  // proposals can coexist. Proposals whose triggering message isn't in the loaded
  // thread render at the bottom (fallback) so none are ever lost.
  const messageIdSet = new Set(messages.map((m) => m.id));
  const tasksByAnchor = new Map<string, ProposedTaskData[]>();
  const orphanTasks: ProposedTaskData[] = [];
  for (const pt of proposedTasks) {
    if (pt.triggering_message_id && messageIdSet.has(pt.triggering_message_id)) {
      const list = tasksByAnchor.get(pt.triggering_message_id) ?? [];
      list.push(pt);
      tasksByAnchor.set(pt.triggering_message_id, list);
    } else {
      orphanTasks.push(pt);
    }
  }
  // Proposed knowledge anchors the same way as tasks.
  const knowledgeByAnchor = new Map<string, ProposedKnowledgeData[]>();
  const orphanKnowledge: ProposedKnowledgeData[] = [];
  for (const pk of proposedKnowledge) {
    if (pk.triggering_message_id && messageIdSet.has(pk.triggering_message_id)) {
      const list = knowledgeByAnchor.get(pk.triggering_message_id) ?? [];
      list.push(pk);
      knowledgeByAnchor.set(pk.triggering_message_id, list);
    } else {
      orphanKnowledge.push(pk);
    }
  }

  const handleEditProposed = (text: string) => {
    setComposerText(text);
    setFocusSignal((n) => n + 1);
  };

  // Keep the newest content (and the proposed reply) in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, messages.length, lastInboundId, proposedReply, proposedTasks.length, proposedKnowledge.length]);

  // "Turn into training" now lives as a header icon (next to the status actions).
  // Clicking it enters selection mode; while selecting, it becomes a compact
  // confirm + cancel. Hidden when there's nothing to select (failed/empty thread).
  const canSelect = !!conversationId && messages.length > 0 && !(error && messages.length === 0);
  // Guardrail: a training example must include at least one HOST message — you
  // can't teach the Agent how to reply from guest messages alone.
  const selectedHasHost = messages.some(
    (m) => m.direction === 'outbound' && selectedIds.has(m.id),
  );
  const canConfirmSelection = selectedIds.size > 0 && selectedHasHost;
  const selectionControls = canSelect ? (
    selectionMode ? (
      <div className="flex items-center gap-1.5">
        <span
          title={
            selectedIds.size > 0 && !selectedHasHost
              ? 'Select at least one host message to train on'
              : undefined
          }
        >
          <Button
            size="sm"
            className="rounded-full"
            disabled={!canConfirmSelection}
            onClick={() => setTurnIntoOpen(true)}
          >
            <GraduationCap className="mr-1.5 h-3.5 w-3.5" />
            Turn into training{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </Button>
        </span>
        <button
          type="button"
          onClick={exitSelection}
          aria-label="Cancel selection"
          title="Cancel"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    ) : hideInlineSelectionEntry ? null : (
      <button
        type="button"
        onClick={() => setSelectionMode(true)}
        aria-label="Turn into training"
        title="Turn into training"
        className="flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
      >
        <GraduationCap className="h-4 w-4" />
      </button>
    )
  ) : null;

  const header = showHeader ? (
    <div className="msg-divider flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <UserAvatar name={guestName ?? 'Guest'} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {guestName ?? 'Guest'}
        </div>
        {propertyName || channel ? (
          <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {propertyName ? <span className="truncate">{propertyName}</span> : null}
            {propertyName && channel ? <span aria-hidden>·</span> : null}
            {channel ? <span className="shrink-0">{canonicalChannelLabel(channel)}</span> : null}
          </div>
        ) : null}
      </div>
      {actions || selectionControls ? (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {selectionControls}
        </div>
      ) : null}
    </div>
  ) : actions || selectionControls ? (
    <div className="msg-divider flex shrink-0 items-center justify-end gap-2 border-b px-4 py-2">
      {actions}
      {selectionControls}
    </div>
  ) : null;

  let body: React.ReactNode;

  if (loading && messages.length === 0) {
    body = <ThreadSkeleton />;
  } else if (error && messages.length === 0) {
    body = (
      <ThreadState
        icon={<AlertCircle className="h-5 w-5" />}
        title="Couldn't load this conversation"
        hint="Something went wrong fetching the messages."
        action={
          onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-[var(--accent-3)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90"
            >
              Try again
            </button>
          ) : undefined
        }
      />
    );
  } else if (messages.length === 0) {
    body = (
      <ThreadState
        icon={<MessagesSquare className="h-5 w-5" />}
        title="No messages yet"
        hint="When this guest writes, the conversation will appear here."
      />
    );
  } else {
    body = (
      <div
        key={conversationId}
        className="msg-in mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-5"
      >
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const outbound = m.direction === 'outbound';
          const isSelected = selectedIds.has(m.id);
          const ts = whenOf(m);
          // Only an OUTBOUND message with a future send time is scheduled (a
          // Hostaway automation). A guest's inbound message is always already
          // sent, so it can never be scheduled regardless of its timestamp.
          const scheduled =
            outbound && !!ts && new Date(ts).getTime() > nowMs + SCHEDULED_SKEW_MS;

          const newDay = !prev || dayKey(whenOf(prev)) !== dayKey(ts);
          const firstOfRun = newDay || !prev || prev.direction !== m.direction;
          const lastOfRun =
            !next ||
            next.direction !== m.direction ||
            dayKey(whenOf(next)) !== dayKey(ts);

          // The previous message carried one or more proposals (reply/task/
          // knowledge) beneath it. Give this message the same breathing room
          // above it as sits above a proposal (its mt-4), so the gap after a
          // proposal matches the gap before it. Back-to-back proposals are
          // unaffected — this only pads the next real message bubble.
          const prevHadProposal =
            !!prev &&
            (prev.id === lastInboundId ||
              tasksByAnchor.has(prev.id) ||
              knowledgeByAnchor.has(prev.id));

          return (
            <Fragment key={m.id}>
              {newDay ? (
                <div className="my-3 flex items-center justify-center">
                  <span className="msg-well rounded-full px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {dayLabel(ts)}
                  </span>
                </div>
              ) : null}

              <div
                onClick={selectionMode ? () => toggleSelect(m.id) : undefined}
                className={`flex items-end gap-2 ${outbound ? 'justify-end' : 'justify-start'} ${
                  prevHadProposal ? 'mt-4' : firstOfRun ? 'mt-2' : 'mt-0.5'
                } ${selectionMode ? 'cursor-pointer' : ''}`}
              >
                {selectionMode ? (
                  <span
                    className={`order-last flex h-4 w-4 shrink-0 items-center justify-center self-center rounded-full border transition-colors ${
                      isSelected
                        ? 'border-[var(--accent-3)] bg-[var(--accent-3)] text-white'
                        : 'border-muted-foreground/40'
                    } ${!outbound ? 'ml-auto' : ''}`}
                    aria-hidden
                  >
                    {isSelected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                ) : null}

                {!outbound ? (
                  <span className="w-7 shrink-0">
                    {lastOfRun ? (
                      <UserAvatar name={guestName ?? 'Guest'} size="sm" className="h-7 w-7" />
                    ) : null}
                  </span>
                ) : null}

                <div className={`flex max-w-[78%] flex-col ${scheduled ? 'opacity-80' : ''}`}>
                  <div
                    style={{ borderRadius: roundedFor(outbound, firstOfRun, lastOfRun) }}
                    className={`px-3.5 py-2 text-sm leading-relaxed ${
                      isSelected ? 'ring-2 ring-[var(--accent-3)] ring-offset-1 ring-offset-[var(--surface)]' : ''
                    } ${
                      scheduled
                        ? 'border border-dashed border-[var(--accent-3)]/50 bg-[var(--accent-bg-soft)] text-foreground dark:border-[var(--accent-1)]/50 dark:bg-[var(--accent-bg-soft-dark)]'
                        : outbound
                          ? 'glass-card glass-sheen relative overflow-hidden border bg-[var(--msg-sent-bg)] border-[var(--msg-sent-border)] text-foreground'
                          : 'bg-white/85 text-foreground shadow-sm ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.06]'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {/* Trimmed: bodies routinely arrive with a trailing
                          newline or two (Hostaway keeps whatever whitespace
                          followed a signature block), and under
                          whitespace-pre-wrap that renders as an empty line
                          padding the bottom of the bubble. A photo-only message
                          has no body — show its attachments, not "(no text)". */}
                      {m.body?.trim() ? (
                        m.body.trim()
                      ) : m.attachments && m.attachments.length > 0 ? null : (
                        <span className="italic opacity-70">(no text)</span>
                      )}
                    </div>
                    {m.attachments && m.attachments.length > 0 && (
                      <MessageAttachments attachments={m.attachments} />
                    )}
                  </div>
                  {lastOfRun ? (
                    <div
                      className={`mt-1 flex items-center gap-1 px-1 text-[10px] tabular-nums text-muted-foreground ${
                        outbound ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {scheduled ? (
                        <>
                          <Clock className="h-3 w-3" aria-hidden />
                          <span>Scheduled · {clockTime(ts)}</span>
                        </>
                      ) : (
                        clockTime(ts)
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              {conversationId && !loading && !error && m.id === lastInboundId && showProposedReply ? (
                <ProposedReply
                  key={`proposal-${m.id}`}
                  conversationId={conversationId}
                  draft={proposedReply}
                  source={proposedReplySource}
                  sources={proposedReplySources}
                  stale={proposalStale}
                  declined={proposalDeclined}
                  onEdit={handleEditProposed}
                  onSend={onSendMessage}
                  onChanged={onProposedReplyChange}
                />
              ) : null}

              {!loading && !error && tasksByAnchor.has(m.id)
                ? tasksByAnchor.get(m.id)!.map((pt) => (
                    <ProposedTask
                      key={`proposed-task-${pt.id}`}
                      proposal={pt}
                      propertyName={propertyName}
                      onOpenEditor={() => onOpenTaskEditor?.(pt)}
                      onChanged={onProposedTaskChange}
                    />
                  ))
                : null}

              {!loading && !error && knowledgeByAnchor.has(m.id)
                ? knowledgeByAnchor.get(m.id)!.map((pk) => (
                    <ProposedKnowledge
                      key={`proposed-knowledge-${pk.id}`}
                      proposal={pk}
                      propertyId={propertyId}
                      onChanged={onProposedKnowledgeChange}
                    />
                  ))
                : null}
            </Fragment>
          );
        })}

        {/* Fallback: proposals whose triggering message isn't in the loaded
            thread render at the bottom so they're always visible until accepted
            or dismissed. */}
        {!loading && !error
          ? orphanTasks.map((pt) => (
              <ProposedTask
                key={`proposed-task-${pt.id}`}
                proposal={pt}
                propertyName={propertyName}
                onOpenEditor={() => onOpenTaskEditor?.(pt)}
                onChanged={onProposedTaskChange}
              />
            ))
          : null}
        {!loading && !error
          ? orphanKnowledge.map((pk) => (
              <ProposedKnowledge
                key={`proposed-knowledge-${pk.id}`}
                proposal={pk}
                propertyId={propertyId}
                onChanged={onProposedKnowledgeChange}
              />
            ))
          : null}
      </div>
    );
  }

  // Hide the composer only when there's nothing to reply to (failed load).
  const showComposer = !(error && messages.length === 0);

  return (
    <div className="flex h-full flex-col">
      {header}
      <div ref={scrollRef} className="overlay-scrollbar min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>
      {showComposer ? (
        <MessageComposer
          guestName={guestName}
          conversationId={conversationId}
          value={composerText}
          onChange={setComposerText}
          onSend={onSendMessage}
          focusSignal={focusSignal}
        />
      ) : null}
      {turnIntoOpen && conversationId ? (
        <TurnIntoTrainingDialog
          conversationId={conversationId}
          messageIds={[...selectedIds]}
          propertyId={propertyId}
          propertyName={propertyName}
          onClose={() => setTurnIntoOpen(false)}
          onCreated={() => {
            setTurnIntoOpen(false);
            exitSelection();
          }}
        />
      ) : null}
    </div>
  );
}

// Asymmetric bubble radius: tighten the corner facing the previous/next bubble
// in a run (on the speaker's side) so a cluster reads as one grouped utterance.
function roundedFor(outbound: boolean, first: boolean, last: boolean): string {
  const big = '1.1rem';
  const tight = '0.4rem';
  const corners = { tl: big, tr: big, br: big, bl: big };
  if (outbound) {
    if (!first) corners.tr = tight;
    if (!last) corners.br = tight;
  } else {
    if (!first) corners.tl = tight;
    if (!last) corners.bl = tight;
  }
  return `${corners.tl} ${corners.tr} ${corners.br} ${corners.bl}`;
}

function ThreadState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="msg-well flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}

function ThreadSkeleton() {
  const rows: ('in' | 'out')[] = ['in', 'in', 'out', 'in', 'out', 'out'];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-5" aria-hidden>
      {rows.map((side, i) => (
        <div key={i} className={`flex ${side === 'out' ? 'justify-end' : 'justify-start'}`}>
          <span
            className="h-9 animate-pulse rounded-2xl bg-black/[0.06] dark:bg-white/[0.07]"
            style={{ width: `${40 + ((i * 13) % 45)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
