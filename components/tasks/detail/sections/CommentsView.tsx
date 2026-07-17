'use client';

import * as React from 'react';
import type { Comment } from '@/lib/types';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { MonoLabel, IconButton } from './HeaderSections';

function initials(name: string | undefined): string {
  return (name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
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
  onPost: () => void;
  onBack: () => void;
}) {
  const keyboardInset = useKeyboardInset();
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [comments.length]);

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
                    <span className="text-[13px] font-medium" style={{ color: 'var(--task-ink-1)' }}>
                      {c.user_name ?? 'Unknown'}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--task-ink-3)' }}>
                      {new Date(c.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className="mt-1 rounded-lg rounded-tl-sm px-3 py-2 text-[14px] leading-relaxed"
                    style={{ background: 'var(--task-surface-1)', color: 'var(--task-ink-1)' }}
                  >
                    {c.comment_content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="flex shrink-0 items-end gap-2 border-t px-[18px] pt-2.5"
        style={{
          borderColor: 'var(--task-line-soft)',
          background: 'var(--task-surface-1)',
          paddingBottom: isMobile
            ? `calc(0.75rem + ${keyboardInset > 0 ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)'})`
            : '0.625rem',
        }}
      >
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onPost();
            }
          }}
          rows={1}
          placeholder="Add a comment…"
          className="max-h-28 min-h-[46px] flex-1 resize-none rounded-xl border px-3.5 py-3 text-[14px] outline-none"
          style={{
            background: 'var(--task-surface-2)',
            borderColor: 'var(--task-line)',
            color: 'var(--task-ink-1)',
          }}
        />
        <button
          type="button"
          aria-label="Send"
          onClick={onPost}
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
