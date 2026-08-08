'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  TaskOptionRow,
} from '@/components/tasks/detail/primitives/TaskSheet';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import type { SessionSummary } from './useAgentChat';
import { groupSessions } from './sessionGroups';
import styles from './SessionList.module.css';

// Saved conversations. Presentational — the hook owns the data and the
// mutations, so the docked panel and the mobile sheet render the same list
// without a second copy of the wiring drifting away from the first.
//
// Row actions hang off a ⋯ button wired to AdaptivePicker, the same primitive
// the task detail panel uses for editing a field: a popover here, a bottom
// sheet if the panel is ever narrow. Previously they were a pencil and a trash
// can revealed on hover, which meant a permanent column of icons on any device
// without one.

/**
 * Coarse "when" label. Coarse on purpose: the list is for finding a
 * conversation again, and "2 days ago" locates it as well as a timestamp
 * would while staying readable at 11px.
 *
 * Exported for the mobile chats screen, which draws its own rows but must not
 * grow a second opinion about how a chat's age is worded.
 */
export function relativeTime(iso: string | null): string {
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

function RowMenu({
  session,
  onRenameStart,
  onDelete,
}: {
  session: SessionSummary;
  onRenameStart: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    // The popover portals out of the row in the DOM but stays a child of it in
    // the React tree, and React events follow the React tree — so without this
    // every menu click also reaches the row's onClick and switches
    // conversations instead of renaming or deleting one.
    <span
      className={styles.rowMenu}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <AdaptivePicker
        open={open}
        onOpenChange={setOpen}
        title={session.title || 'Untitled chat'}
        align="end"
        // The popover defaults to z-50 and the chat panel is z-90, so without
        // this the menu opens behind the list it belongs to.
        contentClassName="z-[95]"
        trigger={
          <button
            type="button"
            className={styles.rowAction}
            aria-label="Chat actions"
          >
            <MoreHorizontal size={15} />
          </button>
        }
      >
        <TaskOptionRow
          onSelect={() => {
            setOpen(false);
            onRenameStart();
          }}
        >
          Rename
        </TaskOptionRow>
        <TaskOptionRow
          onSelect={() => {
            setOpen(false);
            onDelete();
          }}
        >
          <span style={{ color: '#d97757' }}>Delete</span>
        </TaskOptionRow>
      </AdaptivePicker>
    </span>
  );
}

export function SessionList({
  sessions,
  query = '',
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: SessionSummary[];
  query?: string;
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

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sessions.filter((s) => (s.title || '').toLowerCase().includes(needle))
    : sessions;
  // Filter first, group second: a search matching one month renders one header
  // rather than a run of empty ones.
  const groups = groupSessions(shown);

  if (shown.length === 0) {
    return (
      <p className={styles.empty}>
        {needle ? `No chats match “${query.trim()}”.` : 'No saved chats yet.'}
      </p>
    );
  }

  const commitRename = (id: string) => {
    const clean = draft.trim();
    if (clean) onRename(id, clean);
    setRenamingId(null);
  };

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <div key={group.key} className={styles.group}>
          <p className={styles.groupLabel}>{group.label}</p>
          {group.sessions.map((s) => {
            const isRenaming = renamingId === s.id;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                // No selected-row highlight: the list reads as titles, and
                // hover is what tells you where the pointer is.
                className={styles.row}
                // Renaming turns the row into a text field; clicking into it
                // must not also switch conversations out from under the edit.
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
                  <>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {s.title || 'Untitled chat'}
                      </span>
                      <span className={styles.rowMeta}>
                        {relativeTime(s.last_message_at)}
                      </span>
                    </span>
                    <RowMenu
                      session={s}
                      onRenameStart={() => {
                        setDraft(s.title || '');
                        setRenamingId(s.id);
                      }}
                      onDelete={() => onDelete(s.id)}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
