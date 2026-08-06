'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { SessionSummary } from './useAgentChat';
import styles from './SessionList.module.css';

// Saved conversations. Presentational — the hook owns the data and the
// mutations, so the docked panel and the mobile sheet render the same list
// without a second copy of the wiring drifting away from the first.

/**
 * Coarse "when" label. Coarse on purpose: the list is for finding a
 * conversation again, and "2 days ago" locates it as well as a timestamp
 * would while staying readable at 11px.
 */
function relativeTime(iso: string | null): string {
  if (!iso) return 'No messages';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

  if (sessions.length === 0) {
    return <p className={styles.empty}>No saved chats yet.</p>;
  }

  const commitRename = (id: string) => {
    const clean = draft.trim();
    if (clean) onRename(id, clean);
    setRenamingId(null);
  };

  return (
    <div className={styles.list}>
      {sessions.map((s) => {
        const isRenaming = renamingId === s.id;
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`${styles.row}${s.id === activeId ? ` ${styles.rowActive}` : ''}`}
            // Renaming turns the row into a text field; clicking into it must
            // not also switch conversations out from under the edit.
            onClick={() => {
              if (!isRenaming) onSelect(s.id);
            }}
            onKeyDown={(e) => {
              if (isRenaming) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(s.id);
              }
            }}
          >
            {isRenaming ? (
              <input
                ref={inputRef}
                className={styles.renameInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(s.id)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename(s.id);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{s.title || 'Untitled chat'}</span>
                <span className={styles.rowMeta}>
                  {relativeTime(s.last_message_at)}
                </span>
              </span>
            )}

            <span className={styles.rowActions}>
              <button
                type="button"
                className={styles.rowAction}
                title={isRenaming ? 'Save name' : 'Rename'}
                aria-label={isRenaming ? 'Save name' : 'Rename chat'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isRenaming) {
                    commitRename(s.id);
                  } else {
                    setDraft(s.title || '');
                    setRenamingId(s.id);
                  }
                }}
              >
                {isRenaming ? <Check size={13} /> : <Pencil size={13} />}
              </button>
              <button
                type="button"
                className={`${styles.rowAction} ${styles.rowActionDanger}`}
                title="Delete"
                aria-label="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
