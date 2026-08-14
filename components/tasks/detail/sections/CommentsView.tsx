'use client';

import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import type { Comment } from '@/lib/types';
import { useUsers, type AppUser } from '@/lib/useUsers';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import {
  setChatKeyboardOverlay,
  useNativeKeyboardHeight,
} from '@/lib/nativeKeyboard';
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

// The composer: textarea + send with the @-mention typeahead. Two skins:
// 'inline' is the flat desktop row inside the comments section; 'bubble' is
// the mobile floating bar, an exact sibling of the AI chat's liquid-glass
// input (minus the sparkles icon; the paperclip waits on comment
// attachments existing at all).
export function CommentComposer({
  newComment,
  setNewComment,
  posting,
  onPost,
  variant,
  onFocusChange,
}: {
  newComment: string;
  setNewComment: (v: string) => void;
  posting: boolean;
  onPost: (text?: string) => void;
  variant: 'inline' | 'bubble';
  onFocusChange?: (focused: boolean) => void;
}) {
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
    if (newComment === '') {
      pickedRef.current.clear();
      setMention(null);
    }
  }, [newComment]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [mention?.start, mention?.query]);

  // Bubble: grow with content like the chat input (capped, then scroll).
  React.useEffect(() => {
    if (variant !== 'bubble') return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [newComment, variant]);

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

  const textareaProps = {
    ref: textareaRef,
    value: newComment,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setNewComment(e.target.value);
      syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      syncMention(el.value, el.selectionStart ?? el.value.length);
    },
    onFocus: () => onFocusChange?.(true),
    onBlur: () => {
      setMention(null);
      onFocusChange?.(false);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    },
    rows: 1,
    placeholder: 'Add a comment…',
  } as const;

  const mentionPopup = open && (
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
  );

  if (variant === 'bubble') {
    return (
      <div className="relative">
        {mentionPopup}
        <div
          className="flex items-end gap-2 rounded-[1.375rem] border py-[7px] pl-3.5 pr-[7px] backdrop-blur-[14px] backdrop-saturate-150 border-[rgba(0,0,0,0.12)] bg-[rgba(255,255,255,0.72)] shadow-[0_2px_10px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(38,38,44,0.62)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]"
        >
          <textarea
            {...textareaProps}
            className="max-h-[140px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 text-[15px] leading-normal outline-none [scrollbar-width:thin]"
            style={{ color: 'var(--task-ink-1)' }}
          />
          <button
            type="button"
            aria-label="Send"
            // preventDefault keeps the textarea focused: without it the tap
            // blurs the field first, the bar drops with the keyboard, and the
            // click lands on nothing.
            onMouseDown={(e) => e.preventDefault()}
            onClick={handlePost}
            disabled={posting || !newComment.trim()}
            style={{ touchAction: 'manipulation' }}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-opacity disabled:opacity-30 dark:bg-[var(--accent-1)] dark:text-[#12121a]"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {mentionPopup}
      <div className="flex items-end gap-2">
        <textarea
          {...textareaProps}
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
  );
}

// Inline comments: flows in the panel's scroll body (no takeover, no own
// scroll region). The list renders newest-last; on desktop the composer sits
// beneath it, on mobile the composer is the floating MobileCommentBar
// instead, so the section is list-only there.
export function CommentsSection({
  comments,
  loading,
  newComment,
  setNewComment,
  posting,
  onPost,
  showComposer = true,
}: {
  comments: Comment[];
  loading: boolean;
  newComment: string;
  setNewComment: (v: string) => void;
  posting: boolean;
  onPost: (text?: string) => void;
  showComposer?: boolean;
}) {
  const endRef = React.useRef<HTMLDivElement>(null);

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

      {showComposer && (
        <CommentComposer
          newComment={newComment}
          setNewComment={setNewComment}
          posting={posting}
          onPost={onPost}
          variant="inline"
        />
      )}
      <div ref={endRef} />
    </div>
  );
}

// Mobile: the comment composer as a floating bar pinned to the bottom of the
// screen, borrowing the AI chat's keyboard strategy wholesale — while the
// field is being interacted with, the WebView switches to keyboard-overlay
// mode (the screen stops moving) and only this bar rides up by the measured
// keyboard inset. Restored on blur/unmount so every other surface keeps the
// default resize behavior.
export function MobileCommentBar({
  newComment,
  setNewComment,
  posting,
  onPost,
}: {
  newComment: string;
  setNewComment: (v: string) => void;
  posting: boolean;
  onPost: (text?: string) => void;
}) {
  const visualInset = useKeyboardInset();
  const nativeInset = useNativeKeyboardHeight();
  const keyboardInset = Math.max(visualInset, nativeInset);
  const [focused, setFocused] = React.useState(false);

  // Overlay mode must be on BEFORE the keyboard starts animating, so it arms
  // on the first touch (which precedes focus) with focus as the fallback for
  // hardware keyboards / programmatic focus.
  const armOverlay = React.useCallback(() => {
    void setChatKeyboardOverlay(true);
  }, []);
  const disarmOverlay = React.useCallback(() => {
    void setChatKeyboardOverlay(false);
  }, []);
  React.useEffect(() => disarmOverlay, [disarmOverlay]);

  // The keyboard events fire for ANY field on the page (title, description…),
  // so the inset only applies while THIS composer is the one being typed in —
  // otherwise the bar would double-lift to mid-screen. While another field
  // has the keyboard up, the bar stays down entirely (same rule as the
  // checklist ActionBar).
  if (keyboardInset > 0 && !focused) return null;

  return (
    <div
      className="fixed inset-x-0 z-20 px-3"
      style={{
        bottom: focused ? keyboardInset : 0,
        paddingBottom: keyboardInset > 0 && focused ? 8 : 'calc(env(safe-area-inset-bottom) + 8px)',
      }}
      onTouchStart={armOverlay}
    >
      <CommentComposer
        newComment={newComment}
        setNewComment={setNewComment}
        posting={posting}
        onPost={onPost}
        variant="bubble"
        onFocusChange={(f) => {
          setFocused(f);
          if (f) armOverlay();
          else disarmOverlay();
        }}
      />
    </div>
  );
}
