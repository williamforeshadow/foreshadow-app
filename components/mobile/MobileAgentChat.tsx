'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useRouter } from 'next/navigation';
import { ArrowUp, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { AGENT_COMMANDS } from '@/src/lib/agentCommands';
import { ProjectCard } from '@/components/windows/projects/ProjectCard';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';
import {
  isSameOriginHref,
  referencedTasks,
  toRelativeHref,
  useAgentChat,
} from '@/components/ai-chat/useAgentChat';
import { TaskAttachment } from '@/components/ai-chat/TaskAttachment';
import { taskRowToCardItem } from '@/components/ai-chat/taskCardMapping';
import type { TaskRow } from '@/src/agent/tools/findTasks';
import styles from './MobileAgentChat.module.css';

// The mobile agent chat, as a Notion-style bottom sheet. Replaces the old
// compose-then-open flow (a glass composer that handed off to the full-screen
// AiChatPanel): here the sheet IS the whole chat, and the liquid-glass input
// bar persists as its footer once messages start.
//
// Mounted once in AppChrome (mobile only) so the conversation survives route
// changes, mirroring how the desktop AiChatPanel stays mounted. Visibility is
// driven by the shared AiChat context (`isOpen`), so the bottom-nav pill just
// calls open().
//
// Keyboard handling: the app itself stays put (layout viewport is unchanged by
// the keyboard — see useKeyboardInset); the sheet rides up so its input clears
// the keyboard, and its max-height shrinks to the space above it. Dismissing
// the keyboard does NOT close the sheet — it's a real conversation now, so you
// can drop the keyboard to read. Closing is explicit: backdrop, close button,
// or Escape.

const ANIM_MS = 340;
const EXAMPLE_PROMPT = 'What needs my attention today?';

// Horizontally-scrollable task-card carousel. Attaches its wheel listener
// natively (non-passive) so vertical wheel motion over it doesn't bleed into
// the chat body's scroll.
function TaskCardCarousel({
  cards,
  onOpen,
}: {
  cards: TaskRow[];
  onOpen: (taskUrl: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);
  return (
    <div
      ref={ref}
      className="mt-2 -mx-1 flex flex-row gap-2 overflow-x-auto px-1 py-1"
    >
      {cards.map((t) => (
        <div
          key={t.task_id}
          role="button"
          tabIndex={0}
          className="w-[280px] shrink-0 cursor-pointer [&>div]:!cursor-pointer"
          onClick={() => onOpen(t.task_url)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(t.task_url);
            }
          }}
        >
          <ProjectCard
            item={taskRowToCardItem(t)}
            viewMode="status"
            isDragging={false}
          />
        </div>
      ))}
    </div>
  );
}

export function MobileAgentChat() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const router = useRouter();
  const { isOpen, close } = useAiChat();
  const keyboardInset = useKeyboardInset();
  const { messages, isLoading, submitMessage, runCommand, handleConfirmAction } =
    useAgentChat();

  const [inputValue, setInputValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bodyEndRef = useRef<HTMLDivElement>(null);

  // Keep mounted through the exit transition: `shouldRender` gates the DOM,
  // `shown` drives the slide/opacity. (Same pattern the old composer used.)
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [shown, setShown] = useState(false);
  if (isOpen && !shouldRender) setShouldRender(true);
  if (!isOpen && shown) setShown(false);

  // Enter: flip `shown` on just after the sheet mounts (translated down) so it
  // slides up. setTimeout (not rAF) so it still fires when the tab is
  // backgrounded — the sheet must never get stuck off-screen.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => setShown(true), 16);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // Exit: unmount after the slide-down finishes.
  useEffect(() => {
    if (isOpen || !shouldRender) return;
    const t = window.setTimeout(() => setShouldRender(false), ANIM_MS);
    return () => window.clearTimeout(t);
  }, [isOpen, shouldRender]);

  // Focus the input when the sheet opens (raises the keyboard — the pill acts
  // like "tap to type"). preventScroll keeps the app from scrolling up; the
  // sheet rides above the keyboard on its own.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(
      () => taRef.current?.focus({ preventScroll: true }),
      ANIM_MS - 60,
    );
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // Lock body scroll while open so the dimmed app behind can't be scrolled.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Escape closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  // Grow the textarea with its content (capped, then it scrolls internally).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [inputValue]);

  // Keep the latest message in view.
  useEffect(() => {
    bodyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleInternalNav = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    close();
    router.push(toRelativeHref(href) as never);
  };

  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ href, children, ...rest }) => {
        const safeHref = href ?? '';
        if (isSameOriginHref(safeHref)) {
          return (
            <a
              {...rest}
              href={safeHref}
              onClick={(e) => handleInternalNav(e, safeHref)}
            >
              {children}
            </a>
          );
        }
        return (
          <a {...rest} href={safeHref} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    // handleInternalNav is stable enough for this surface; router/close are
    // module-stable. Deps intentionally minimal to avoid re-creating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const send = () => {
    const text = inputValue.trim();
    if (!text || isLoading || !user) return;
    submitMessage(text);
    setInputValue('');
  };

  // Slash-command autocomplete.
  const trimmedInput = inputValue.trim().toLowerCase();
  const commandMatches = trimmedInput.startsWith('/')
    ? AGENT_COMMANDS.filter((c) => c.name.startsWith(trimmedInput))
    : [];
  const showCommandMenu = commandMatches.length > 0 && !isLoading;

  const isEmpty = messages.length === 0 && !isLoading;

  if (isMobile !== true || !shouldRender) return null;

  // Cap the sheet at 85% of the screen, but never let it grow past the space
  // above the keyboard. env() safe-area is folded in so the input clears the
  // home indicator when no keyboard is up.
  const maxHeight = `min(85dvh, calc(100dvh - ${keyboardInset}px - 0.75rem))`;

  return (
    <>
      <button
        type="button"
        aria-label="Close chat"
        onClick={close}
        className={`${styles.backdrop} ${
          shown ? styles.backdropShown : styles.backdropHidden
        }`}
      />
      {/* The wrapper (position: fixed) carries the keyboard lift; the sheet is a
          static flex child, so `bottom` on it would be inert. */}
      <div className={styles.wrap} style={{ bottom: keyboardInset }}>
        <div
          className={`${styles.sheet} ${
            shown ? styles.sheetShown : styles.sheetHidden
          }`}
          style={{ maxHeight }}
          role="dialog"
          aria-label="Foreshadow AI chat"
        >
          <div className={styles.header}>
            <span className={styles.grabber} aria-hidden />
            <span className={styles.title}>
              <Sparkles size={14} className={styles.titleIcon} aria-hidden />
              Ask Foreshadow
            </span>
            <button
              type="button"
              className={styles.closeButton}
              onClick={close}
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </div>

          <div className={styles.body}>
            {isEmpty ? (
              <div className={styles.empty}>
                <p className={styles.emptyText}>How can I help?</p>
                <div className={styles.chips}>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => runCommand('/myassignments')}
                  >
                    My assignments
                  </button>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => runCommand('/dailyoutlook')}
                  >
                    Daily outlook
                  </button>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => submitMessage(EXAMPLE_PROMPT)}
                  >
                    {EXAMPLE_PROMPT}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.messages}>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`${styles.row} ${
                      msg.role === 'user' ? styles.rowUser : styles.rowAssistant
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <div className={styles.userBubble}>{msg.content}</div>
                    ) : (
                      <div className={styles.assistant}>
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5">
                          <ReactMarkdown components={markdownComponents}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                        {msg.tasks &&
                          (() => {
                            const cards = referencedTasks(
                              msg.content,
                              msg.tasks,
                            );
                            if (cards.length === 0) return null;
                            const onOpen = (url: string) => {
                              close();
                              router.push(toRelativeHref(url) as never);
                            };
                            if (cards.length <= 5) {
                              return (
                                <TaskCardCarousel cards={cards} onOpen={onOpen} />
                              );
                            }
                            return (
                              <TaskAttachment cards={cards} onOpen={onOpen} />
                            );
                          })()}
                        {msg.pendingActionIds &&
                          msg.pendingActionIds.length > 0 &&
                          (msg.confirmation === 'pending' ||
                            msg.confirmation === 'confirming') && (
                            <div className={styles.confirmationButtons}>
                              <Button
                                size="sm"
                                onClick={() =>
                                  handleConfirmAction(
                                    msg.id,
                                    msg.pendingActionIds!,
                                    'confirm',
                                  )
                                }
                                disabled={msg.confirmation === 'confirming'}
                              >
                                {msg.confirmation === 'confirming'
                                  ? 'Working…'
                                  : 'Confirm'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleConfirmAction(
                                    msg.id,
                                    msg.pendingActionIds!,
                                    'cancel',
                                  )
                                }
                                disabled={msg.confirmation === 'confirming'}
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className={`${styles.row} ${styles.rowAssistant}`}>
                    <div className={styles.loadingDots}>
                      <span className={styles.loadingDot} />
                      <span className={styles.loadingDot} />
                      <span className={styles.loadingDot} />
                    </div>
                  </div>
                )}
                <div ref={bodyEndRef} />
              </div>
            )}
          </div>

          <div
            className={styles.footer}
            style={{
              paddingBottom: keyboardInset
                ? '0.75rem'
                : 'calc(env(safe-area-inset-bottom) + 0.75rem)',
            }}
          >
            {showCommandMenu && (
              <div className={styles.commandMenu}>
                {commandMatches.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={styles.commandMenuItem}
                    onClick={() => {
                      runCommand(c.name);
                      setInputValue('');
                    }}
                  >
                    <span className={styles.commandName}>{c.name}</span>
                    <span className={styles.commandDesc}>{c.description}</span>
                  </button>
                ))}
              </div>
            )}
            <div className={styles.field}>
              <Sparkles size={18} className={styles.fieldIcon} aria-hidden />
              <textarea
                ref={taRef}
                className={styles.textarea}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={user ? 'Ask the agent…' : 'Sign in to chat'}
                aria-label="Ask the agent"
              />
              <button
                type="button"
                className={styles.sendButton}
                onClick={send}
                disabled={isLoading || !inputValue.trim() || !user}
                aria-label="Send"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
