'use client';

import { Fragment } from 'react';
import { MessagesSquare, AlertCircle } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
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
  guestName,
  propertyName,
  channel,
  loading,
  error,
  onRetry,
  showHeader = true,
  actions,
}: {
  messages: GuestMessageRecord[];
  guestName?: string | null;
  propertyName?: string | null;
  channel?: string | null;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  showHeader?: boolean;
  actions?: React.ReactNode;
}) {
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

                <div className="flex max-w-[78%] flex-col">
                  <div
                    style={{ borderRadius: roundedFor(outbound, firstOfRun, lastOfRun) }}
                    className={`px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                      outbound
                        ? 'bg-[var(--accent-3)] text-white'
                        : 'bg-card text-foreground ring-1 ring-[var(--surface-elevated-line)]'
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
                      className={`mt-1 px-1 text-[10px] tabular-nums text-muted-foreground ${
                        outbound ? 'text-right' : 'text-left'
                      }`}
                    >
                      {clockTime(ts)}
                    </div>
                  ) : null}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
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
