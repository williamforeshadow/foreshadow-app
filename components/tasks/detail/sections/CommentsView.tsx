'use client';

import * as React from 'react';
import type { Comment } from '@/lib/types';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { useUsers, type AppUser } from '@/lib/useUsers';
import { parseMentionTokens, formatMentionToken } from '@/lib/mentions';
import { MonoLabel, IconButton } from './HeaderSections';

function initials(name: string | undefined): string {
  return (name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Renders stored comment text, turning @[Name](uuid) mention tokens into
// accent chips. Non-token text passes through untouched.
function MentionText({ text }: { text: string }) {
  const tokens = parseMentionTokens(text);
  if (tokens.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((t, i) => {
    if (t.start > cursor) parts.push(text.slice(cursor, t.start));
    parts.push(
      <span
        key={`m-${i}`}
        className="rounded px-1 font-medium"
        style={{ background: 'var(--task-accent-soft)', color: 'var(--task-accent)' }}
      >
        @{t.name}
      </span>,
    );
    cursor = t.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// The composer shows plain "@Name" while typing; this converts the display
// text back to wire tokens at submit time using the names the user actually
// picked from the typeahead (longest name first, so "Billy Hale Jr" wins
// over "Billy Hale"). A name that was edited after selection simply stops
// matching and posts as plain text — mention silently degrades, never
// mis-targets.
function applyMentions(display: string, picked: Map<string, AppUser>): string {
  let out = display;
  const byLength = [...picked.values()].sort((a, b) => b.name.length - a.name.length);
  for (const user of byLength) {
    const escaped = user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`@${escaped}(?![\\w])`, 'g'),
      formatMentionToken(user),
    );
  }
  return out;
}

// Active "@query" being typed at the caret, if any. Query may contain spaces
// (names do) but never newlines or a second '@'; capped so an essay after a
// stray @ doesn't keep the popup logic churning.
function activeMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const upToCaret = value.slice(0, caret);
  const match = /(^|\s)@([^@\n]{0,30})$/.exec(upToCaret);
  if (!match) return null;
  return { start: match.index + match[1].length, query: match[2] };
}

function filterUsers(users: AppUser[], query: string): AppUser[] {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  return users.filter(
    (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
  );
}

// Full-takeover comments page (mobile push / desktop in-panel takeover).
export function CommentsView({
  isMobile,
  comments,
  loading,
  newComment,
  setNewComment,
  posting,
  onPost,
  onBack,
}: {
  isMobile: boolean;
  comments: Comment[];
  loading: boolean;
  newComment: string;
  setNewComment: (v: string) => void;
  posting: boolean;
  onPost: (text?: string) => void;
  onBack: () => void;
}) {
  const keyboardInset = useKeyboardInset();
  const listRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const { users } = useUsers();

  // Users picked from the typeahead this session, keyed by display name.
  // Only picked names convert to tokens at submit — typing "@Billy Hale" by
  // hand without selecting stays plain text.
  const pickedRef = React.useRef<Map<string, AppUser>>(new Map());
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  // Set when the user Escapes out of the popup; stays dismissed until the
  // active-@ context changes (new @ or caret moved off this one).
  const dismissedAtRef = React.useRef<number | null>(null);

  const candidates = React.useMemo(
    () => (mention ? filterUsers(users, mention.query) : []),
    [users, mention],
  );
  const open = mention !== null && candidates.length > 0;

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [comments.length]);

  React.useEffect(() => {
    if (newComment === '') {
      pickedRef.current.clear();
      setMention(null);
    }
  }, [newComment]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [mention?.start, mention?.query]);

  const syncMention = React.useCallback((value: string, caret: number) => {
    const found = activeMentionQuery(value, caret);
    if (found && dismissedAtRef.current === found.start) {
      setMention(null);
      return;
    }
    if (!found || dismissedAtRef.current !== found.start) dismissedAtRef.current = null;
    setMention(found);
  }, []);

  const selectUser = React.useCallback(
    (user: AppUser) => {
      const el = textareaRef.current;
      if (!el || !mention) return;
      const caret = el.selectionStart ?? newComment.length;
      const inserted = `@${user.name} `;
      const next = newComment.slice(0, mention.start) + inserted + newComment.slice(caret);
      pickedRef.current.set(user.name, user);
      setNewComment(next);
      setMention(null);
      const newCaret = mention.start + inserted.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
      });
    },
    [mention, newComment, setNewComment],
  );

  const handlePost = React.useCallback(() => {
    if (posting || !newComment.trim()) return;
    onPost(applyMentions(newComment.trim(), pickedRef.current));
  }, [posting, newComment, onPost]);

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col"
      style={{ background: 'var(--task-surface-0)' }}
    >
      <div
        className="flex h-12 shrink-0 items-center justify-between border-b px-[18px]"
        style={{ borderColor: 'var(--task-line-soft)' }}
      >
        <div className="-ml-2">
          <IconButton label="Back" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </IconButton>
        </div>
        <MonoLabel>Comments</MonoLabel>
        <div className="w-[26px]" />
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-[18px] py-4">
        {loading ? (
          <MonoLabel>Loading…</MonoLabel>
        ) : comments.length === 0 ? (
          <MonoLabel>No comments yet</MonoLabel>
        ) : (
          <div className="flex flex-col gap-4">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium"
                  style={{ background: 'var(--task-accent-soft)', color: 'var(--task-accent)' }}
                >
                  {initials(c.user_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[length:var(--task-fs-body-sm)] font-medium" style={{ color: 'var(--task-ink-1)' }}>
                      {c.user_name ?? 'Unknown'}
                    </span>
                    <span className="font-mono text-[length:var(--task-fs-label)]" style={{ color: 'var(--task-ink-3)' }}>
                      {new Date(c.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className="mt-1 rounded-lg rounded-tl-sm px-3 py-2 text-[length:var(--task-fs-body)] leading-relaxed"
                    style={{ background: 'var(--task-surface-1)', color: 'var(--task-ink-1)' }}
                  >
                    <MentionText text={c.comment_content} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative shrink-0">
        {open && (
          <div
            className="absolute inset-x-[18px] bottom-full z-20 mb-2 max-h-56 overflow-y-auto rounded-xl border shadow-lg"
            style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)' }}
            role="listbox"
            aria-label="Mention a teammate"
          >
            {candidates.map((u, i) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                // onMouseDown so the textarea never loses focus/caret
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectUser(u);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
                style={{
                  background: i === activeIndex ? 'var(--task-accent-soft)' : 'transparent',
                }}
              >
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-medium"
                  style={{ background: 'var(--task-accent-soft)', color: 'var(--task-accent)' }}
                >
                  {initials(u.name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[length:var(--task-fs-body-sm)] font-medium" style={{ color: 'var(--task-ink-1)' }}>
                    {u.name}
                  </div>
                  <div className="truncate font-mono text-[length:var(--task-fs-label)]" style={{ color: 'var(--task-ink-3)' }}>
                    {u.email}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div
          className="flex items-end gap-2 border-t px-[18px] pt-2.5"
          style={{
            borderColor: 'var(--task-line-soft)',
            background: 'var(--task-surface-1)',
            paddingBottom: isMobile
              ? `calc(0.75rem + ${keyboardInset > 0 ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)'})`
              : '0.625rem',
          }}
        >
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={(e) => {
              setNewComment(e.target.value);
              syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              syncMention(el.value, el.selectionStart ?? el.value.length);
            }}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              if (open) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIndex((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  selectUser(candidates[activeIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  dismissedAtRef.current = mention?.start ?? null;
                  setMention(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handlePost();
              }
            }}
            rows={1}
            placeholder="Add a comment…"
            className="max-h-28 min-h-[46px] flex-1 resize-none rounded-xl border px-3.5 py-3 text-[length:var(--task-fs-body)] outline-none"
            style={{
              background: 'var(--task-surface-2)',
              borderColor: 'var(--task-line)',
              color: 'var(--task-ink-1)',
            }}
          />
          <button
            type="button"
            aria-label="Send"
            onClick={handlePost}
            disabled={posting || !newComment.trim()}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl transition-transform active:scale-95 disabled:opacity-40"
            style={{ background: 'var(--task-accent)', color: '#0c0c0e' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12l16-7-7 16-2.5-6.5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
