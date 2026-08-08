'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { SessionSummary } from '@/components/ai-chat/useAgentChat';
import { relativeTime } from '@/components/ai-chat/SessionList';
import styles from './MobileSessionList.module.css';

// The mobile chats screen. A separate component from the docked panel's
// SessionList because the two want opposite things: the panel has hover, so it
// can reveal rename/delete on the row and keep rows tight. Touch has neither.
// Here the row is only a title and an age, sized to be hit with a thumb, and
// the actions live behind a long press. The data and the mutations are still
// the hook's — only the presentation diverges.

const LONG_PRESS_MS = 450;
// How far a finger may wander before the press is read as the start of a
// scroll rather than a hold.
const PRESS_SLOP = 8;

export function MobileSessionList({
  sessions,
  activeId,
  query,
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  query: string;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  // A long press ends in a touchend like any other tap, and the browser sends
  // the click anyway. Swallow that one, or opening the menu also opens the chat.
  const swallowClick = useRef(false);

  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressOrigin.current = null;
  };
  useEffect(() => cancelPress, []);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sessions.filter((s) => (s.title || '').toLowerCase().includes(needle))
    : sessions;

  const commitRename = (id: string) => {
    const clean = draft.trim();
    if (clean) onRename(id, clean);
    setRenamingId(null);
  };

  const openMenu = (id: string) => {
    swallowClick.current = true;
    setMenuId(id);
  };

  if (shown.length === 0) {
    return (
      <p className={styles.empty}>
        {needle ? `No chats match “${query.trim()}”.` : 'No saved chats yet.'}
      </p>
    );
  }

  const menuSession = sessions.find((s) => s.id === menuId) ?? null;

  return (
    <div className={styles.list}>
      {shown.map((s) => {
        const isRenaming = renamingId === s.id;
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`${styles.row}${s.id === activeId ? ` ${styles.rowActive}` : ''}`}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              if (!isRenaming) onSelect(s.id);
            }}
            onKeyDown={(e) => {
              if (isRenaming) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(s.id);
              }
            }}
            onTouchStart={(e) => {
              if (isRenaming || e.touches.length !== 1) return;
              const t = e.touches[0];
              pressOrigin.current = { x: t.clientX, y: t.clientY };
              pressTimer.current = window.setTimeout(() => {
                pressTimer.current = null;
                openMenu(s.id);
              }, LONG_PRESS_MS);
            }}
            onTouchMove={(e) => {
              const origin = pressOrigin.current;
              if (!origin) return;
              const t = e.touches[0];
              if (
                Math.abs(t.clientX - origin.x) > PRESS_SLOP ||
                Math.abs(t.clientY - origin.y) > PRESS_SLOP
              ) {
                cancelPress();
              }
            }}
            onTouchEnd={cancelPress}
            onTouchCancel={cancelPress}
            // Keyboard and pointer users never get the long press, so the same
            // menu answers a right-click / context-menu key.
            onContextMenu={(e) => {
              if (isRenaming) return;
              e.preventDefault();
              openMenu(s.id);
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
                <span className={styles.rowTitle}>
                  {s.title || 'Untitled chat'}
                </span>
                <span className={styles.rowMeta}>
                  {relativeTime(s.last_message_at)}
                </span>
              </>
            )}
          </div>
        );
      })}

      {menuSession && (
        <>
          <button
            type="button"
            className={styles.menuBackdrop}
            aria-label="Dismiss menu"
            onClick={() => setMenuId(null)}
          />
          <div className={styles.menu} role="menu">
            <p className={styles.menuTitle}>
              {menuSession.title || 'Untitled chat'}
            </p>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setDraft(menuSession.title || '');
                setRenamingId(menuSession.id);
                setMenuId(null);
              }}
            >
              <Pencil size={17} />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.menuItem} ${styles.menuDanger}`}
              onClick={() => {
                onDelete(menuSession.id);
                setMenuId(null);
              }}
            >
              <Trash2 size={17} />
              Delete
            </button>
            <button
              type="button"
              className={styles.menuCancel}
              onClick={() => setMenuId(null)}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
