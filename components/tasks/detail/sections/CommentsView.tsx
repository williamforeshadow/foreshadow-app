'use client';

import * as React from 'react';
import type { Comment } from '@/lib/types';
import { useUsers, type AppUser } from '@/lib/useUsers';
import { parseMentionTokens, formatMentionToken } from '@/lib/mentions';
import { MonoLabel } from './HeaderSections';
import { LoadingState } from '@/components/ui/loading-state';

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

// Inline comments: flows in the panel's scroll body (no takeover, no own
// scroll region). The list renders newest-last with the composer beneath it.
export function CommentsSection({
  comments,
  loading,
  newComment,
  setNewComment,
  posting,
  onPost,
}: {
  comments: Comment[];
  loading: boolean;
  newComment: string;
  setNewComment: (v: string) => void;
  posting: boolean;
  onPost: (text?: string) => void;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
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

  // Keep the composer in view when a comment lands (posting pushes it down).
  // Only after the initial load — opening the panel must not yank the scroll.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (loading) return;
    if (!seededRef.current) {
      seededRef.current = true;
      return;
    }
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [comments.length, loading]);

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
    <div>
      <MonoLabel className="mb-2.5">
        Comments{comments.length > 0 ? ` · ${comments.length}` : ''}
      </MonoLabel>

      {loading ? (
        <LoadingState size={4} />
      ) : comments.length === 0 ? null : (
        <div className="mb-3 flex flex-col gap-4">
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

      <div className="relative">
        {open && (
          <div
            className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-56 overflow-y-auto rounded-xl border shadow-lg"
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

        <div className="flex items-end gap-2">
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
        <div ref={endRef} />
      </div>
    </div>
  );
}
