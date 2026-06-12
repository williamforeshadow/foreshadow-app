'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { MessagesSquare, AlertCircle, Clock } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { MessageComposer } from '@/components/messages/MessageComposer';
import { ProposedReply } from '@/components/messages/ProposedReply';
import { ProposedTask, type ProposedTaskData } from '@/components/messages/ProposedTask';
import { ProposedKnowledge, type ProposedKnowledgeData } from '@/components/messages/ProposedKnowledge';
import { canonicalChannelLabel } from '@/lib/bookingChannel';
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

export function ConversationThread({
  messages,
  conversationId,
  guestName,
  propertyName,
  channel,
  loading,
  error,
  onRetry,
  showHeader = true,
  actions,
  proposedReply = null,
  proposedReplySource = null,
  proposedReplyAnswersMessageId = null,
  onProposedReplyChange,
  proposedTasks = [],
  onProposedTaskChange,
  proposedKnowledge = [],
  onProposedKnowledgeChange,
}: {
  messages: GuestMessageRecord[];
  conversationId?: string;
  guestName?: string | null;
  propertyName?: string | null;
  channel?: string | null;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  showHeader?: boolean;
  actions?: React.ReactNode;
  /** The conversation's persisted proposed reply (read, not regenerated here). */
  proposedReply?: string | null;
  proposedReplySource?: 'auto' | 'assistant' | null;
  proposedReplyAnswersMessageId?: string | null;
  onProposedReplyChange?: () => void;
  /** The conversation's pending proposed tasks (multiple can coexist). */
  proposedTasks?: ProposedTaskData[];
  onProposedTaskChange?: () => void;
  /** The conversation's pending proposed knowledge additions. */
  proposedKnowledge?: ProposedKnowledgeData[];
  onProposedKnowledgeChange?: () => void;
}) {
  // Render-stable "now" for the scheduled-vs-sent check (one value per mount).
  const [nowMs] = useState(() => Date.now());
  const [composerText, setComposerText] = useState('');
  const [focusSignal, setFocusSignal] = useState(0);
  const [prevConvId, setPrevConvId] = useState(conversationId);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset per-conversation UI when the open conversation changes (render-time
  // reset — React's recommended pattern, avoids a setState-in-effect).
  if (conversationId !== prevConvId) {
    setPrevConvId(conversationId);
    setComposerText('');
  }

  // The latest actually-sent message (future-dated host automations don't count).
  // When it's from the guest, the conversation is awaiting a host reply — that's
  // where the persisted proposed reply is anchored.
  const sentMessages = messages.filter(
    (m) => !(m.direction === 'outbound' && m.sent_at && new Date(m.sent_at).getTime() > nowMs),
  );
  const lastSent = sentMessages.length ? sentMessages[sentMessages.length - 1] : undefined;
  const awaitingReply = lastSent?.direction === 'inbound';
  const lastInboundId = awaitingReply ? lastSent!.id : null;
  // The stored draft is stale if it was written against an older message.
  const proposalStale =
    !!proposedReply && !!lastInboundId && proposedReplyAnswersMessageId !== lastInboundId;

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

  const header = showHeader ? (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--surface-elevated-divider)] bg-[var(--surface-elevated)] px-4 py-3">
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
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  ) : actions ? (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[var(--surface-elevated-divider)] bg-[var(--surface-elevated)] px-4 py-2">
      {actions}
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-5">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const outbound = m.direction === 'outbound';
          const ts = whenOf(m);
          // Only an OUTBOUND message with a future send time is scheduled (a
          // Hostaway automation). A guest's inbound message is always already
          // sent, so it can never be scheduled regardless of its timestamp.
          const scheduled = outbound && !!ts && new Date(ts).getTime() > nowMs;

          const newDay = !prev || dayKey(whenOf(prev)) !== dayKey(ts);
          const firstOfRun = newDay || !prev || prev.direction !== m.direction;
          const lastOfRun =
            !next ||
            next.direction !== m.direction ||
            dayKey(whenOf(next)) !== dayKey(ts);

          return (
            <Fragment key={m.id}>
              {newDay ? (
                <div className="my-3 flex items-center justify-center">
                  <span className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {dayLabel(ts)}
                  </span>
                </div>
              ) : null}

              <div
                className={`flex items-end gap-2 ${outbound ? 'justify-end' : 'justify-start'} ${
                  firstOfRun ? 'mt-2' : 'mt-0.5'
                }`}
              >
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
                      scheduled
                        ? 'border border-dashed border-[var(--accent-3)]/50 bg-[var(--accent-bg-soft)] text-foreground dark:bg-[var(--accent-bg-soft-dark)]'
                        : outbound
                          ? 'bg-[var(--accent-3)] text-white shadow-sm'
                          : 'bg-card text-foreground shadow-sm ring-1 ring-[var(--surface-elevated-line)]'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {m.body?.trim() ? (
                        m.body
                      ) : (
                        <span className="italic opacity-70">(no text)</span>
                      )}
                    </div>
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

              {conversationId && !loading && !error && m.id === lastInboundId ? (
                <ProposedReply
                  key={`proposal-${m.id}`}
                  conversationId={conversationId}
                  draft={proposedReply}
                  source={proposedReplySource}
                  stale={proposalStale}
                  onEdit={handleEditProposed}
                  onChanged={onProposedReplyChange}
                />
              ) : null}

              {!loading && !error && tasksByAnchor.has(m.id)
                ? tasksByAnchor.get(m.id)!.map((pt) => (
                    <ProposedTask
                      key={`proposed-task-${pt.id}`}
                      proposal={pt}
                      onChanged={onProposedTaskChange}
                    />
                  ))
                : null}

              {!loading && !error && knowledgeByAnchor.has(m.id)
                ? knowledgeByAnchor.get(m.id)!.map((pk) => (
                    <ProposedKnowledge
                      key={`proposed-knowledge-${pk.id}`}
                      proposal={pk}
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
                onChanged={onProposedTaskChange}
              />
            ))
          : null}
        {!loading && !error
          ? orphanKnowledge.map((pk) => (
              <ProposedKnowledge
                key={`proposed-knowledge-${pk.id}`}
                proposal={pk}
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
    <div className="flex h-full flex-col bg-[var(--background)]">
      {header}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>
      {showComposer ? (
        <MessageComposer
          guestName={guestName}
          conversationId={conversationId}
          value={composerText}
          onChange={setComposerText}
          focusSignal={focusSignal}
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
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
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
            className="h-9 animate-pulse rounded-2xl bg-accent"
            style={{ width: `${40 + ((i * 13) % 45)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
