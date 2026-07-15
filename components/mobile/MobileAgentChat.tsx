'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useRouter } from 'next/navigation';
import { ArrowUp, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import {
  setChatKeyboardOverlay,
  useNativeKeyboardHeight,
} from '@/lib/nativeKeyboard';
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

// The mobile agent chat, built as two INDEPENDENT layers so the input never
// feels stapled to the conversation:
//
//   1. The input bubble — a floating liquid-glass bar pinned just above the
//      software keyboard (and dropping to the bottom + safe-area when the
//      keyboard is down). It is the only thing that tracks the keyboard.
//   2. The conversation drawer — anchored to the BOTTOM of the screen and always
//      rendered down to it, so it never lifts or gets cut off. When the keyboard
//      is up, its lower portion simply sits behind the keyboard; the input
//      floats over it (messages scroll behind the glass).
//
// The drawer only exists once a conversation does: tapping the pill first shows
// just the floating input over the dimmed app. The first send brings the drawer
// up behind the input.
//
// Mounted once in AppChrome (mobile only) so the conversation survives route
// changes. Closing is explicit (backdrop tap / Escape); dismissing the keyboard
// just lowers it and leaves everything open.

const ANIM_MS = 300;
const GAP = 12; // breathing room between the newest message and the input

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
  // Two keyboard signals: visualViewport (web + Android) and the native plugin
  // (iOS overlay mode, where the WebView no longer shrinks so visualViewport
  // reports nothing). Whichever sees the keyboard wins.
  const visualInset = useKeyboardInset();
  const nativeInset = useNativeKeyboardHeight();
  const keyboardInset = Math.max(visualInset, nativeInset);
  const { messages, isLoading, submitMessage, runCommand, handleConfirmAction } =
    useAgentChat();

  const [inputValue, setInputValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Overlay enter/exit: `shouldRender` gates the DOM, `shown` drives the
  // backdrop + input transitions.
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [shown, setShown] = useState(false);
  // Measured input-bar and header heights, so the scroll region can be sized to
  // exactly the visible area above the floating input (see scrollMaxHeight).
  const [inputH, setInputH] = useState(52);
  const [headerH, setHeaderH] = useState(44);

  if (isOpen && !shouldRender) setShouldRender(true);
  if (!isOpen && shown) setShown(false);

  // The drawer only exists once there's something to show.
  const hasConversation = messages.length > 0 || isLoading;
  const drawerMounted = shouldRender && hasConversation;
  const [drawerIn, setDrawerIn] = useState(false);

  // Enter the overlay just after mount so the input transitions up.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => setShown(true), 16);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // Unmount after the exit transition.
  useEffect(() => {
    if (isOpen || !shouldRender) return;
    const t = window.setTimeout(() => setShouldRender(false), ANIM_MS);
    return () => window.clearTimeout(t);
  }, [isOpen, shouldRender]);

  // Slide the drawer up the first time it mounts (a beat after it appears), so
  // it reads as rising behind the input rather than snapping in.
  useEffect(() => {
    if (!drawerMounted) {
      setDrawerIn(false);
      return;
    }
    const t = window.setTimeout(() => setDrawerIn(true), 16);
    return () => window.clearTimeout(t);
  }, [drawerMounted]);

  // Focus the input when the chat opens (raises the keyboard). preventScroll so
  // the app itself doesn't shift — only the input rides up.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(
      () => taRef.current?.focus({ preventScroll: true }),
      ANIM_MS - 40,
    );
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // iOS only: switch the WebView to keyboard-overlay mode while the chat is open
  // so the keyboard floats over a full-screen WebView (the drawer stays pinned
  // to the screen bottom, only the input rides up). Restored on close. No-op on
  // web/Android. See lib/nativeKeyboard.
  useEffect(() => {
    if (!isOpen) return;
    setChatKeyboardOverlay(true);
    return () => {
      setChatKeyboardOverlay(false);
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

  // Track the input bar's height so the scroll region sizing stays exact as it
  // grows.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const update = () => setInputH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shouldRender]);

  // Measure the drawer header so the scroll region can subtract it precisely.
  useEffect(() => {
    const el = headerRef.current;
    if (el) setHeaderH(el.offsetHeight);
  }, [drawerMounted]);

  // Keep the newest message in view as messages arrive, the keyboard toggles,
  // or the geometry shifts (all change how tall the scroll region is).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading, keyboardInset, inputH, headerH, drawerMounted]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const send = () => {
    const text = inputValue.trim();
    if (!text || isLoading || !user) return;
    submitMessage(text);
    setInputValue('');
  };

  const trimmedInput = inputValue.trim().toLowerCase();
  const commandMatches = trimmedInput.startsWith('/')
    ? AGENT_COMMANDS.filter((c) => c.name.startsWith(trimmedInput))
    : [];
  const showCommandMenu = commandMatches.length > 0 && !isLoading;

  if (isMobile !== true || !shouldRender) return null;

  // The floating input sits 8px above the screen bottom (above the keyboard when
  // up, above the home indicator when down); it stacks input height + a gap.
  const inputPadBottom =
    keyboardInset > 0 ? 8 : 'calc(env(safe-area-inset-bottom) + 8px)';

  // Size the scroll region to exactly the visible area above the input: the
  // drawer height (85dvh) minus the header minus the space the input reserves.
  // An explicit max-height (not flex + a big padding-bottom) is what iOS
  // reliably bounds a scroll container by, so scrolling engages as soon as the
  // thread can't fit above the input — not only once it fills the whole screen.
  const scrollMaxHeight =
    keyboardInset > 0
      ? `calc(85dvh - ${headerH + keyboardInset + 8 + inputH + GAP}px)`
      : `calc(85dvh - ${headerH + 8 + inputH + GAP}px - env(safe-area-inset-bottom))`;

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

      {drawerMounted && (
        <div
          className={`${styles.drawer} ${
            drawerIn && shown ? styles.drawerShown : styles.drawerHidden
          }`}
          role="dialog"
          aria-label="Foreshadow AI chat"
        >
          <div ref={headerRef} className={styles.header}>
            <button
              type="button"
              className={styles.closeButton}
              onClick={close}
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </div>

          <div
            ref={scrollRef}
            className={styles.messagesScroll}
            style={{ maxHeight: scrollMaxHeight }}
          >
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
                          const cards = referencedTasks(msg.content, msg.tasks);
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
                          return <TaskAttachment cards={cards} onOpen={onOpen} />;
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
            </div>
          </div>
        </div>
      )}

      {/* Floating input — a separate fixed layer pinned above the keyboard,
          independent of the drawer. pointer-events pass through the wrapper so
          taps beside the field fall through to the backdrop. */}
      <div
        className={`${styles.inputWrap} ${
          shown ? styles.inputShown : styles.inputHidden
        }`}
        style={{ bottom: keyboardInset, paddingBottom: inputPadBottom }}
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
        <div ref={fieldRef} className={styles.field}>
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
    </>
  );
}
