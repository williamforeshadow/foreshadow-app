'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useRouter } from 'next/navigation';
import { ArrowUp, History, Paperclip, Sparkles, SquarePen } from 'lucide-react';
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
import { SessionList } from '@/components/ai-chat/SessionList';
import {
  ComposerAttachments,
  MessageAttachments,
} from '@/components/ai-chat/ComposerAttachments';
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
// Both layers arrive together when the pill is tapped: the drawer rises to its
// full height (empty until messages arrive) with the input floating in front of
// it, so the chat reads as a place you've entered rather than a lone text field.
//
// The drawer's own controls (history, new chat) float in its top corners rather
// than sitting in a header that reserves height — the thread runs the full
// height and fades out underneath them.
//
// Mounted once in AppChrome (mobile only) so the conversation survives route
// changes. Closing is a swipe down, a backdrop tap, or Escape; dismissing the
// keyboard just lowers it and leaves everything open.

const ANIM_MS = 300;
const GAP = 12; // breathing room between the newest message and the input
// Swipe-down dismissal: far enough that a scroll overshoot isn't a close, or a
// flick fast enough that the distance clearly wasn't the point.
const DISMISS_PX = 96;
const DISMISS_VELOCITY = 0.5; // px/ms
// The grab strip along the drawer's top edge, level with the corner buttons.
const DRAG_STRIP = 56;

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
  const {
    messages,
    isLoading,
    sessions,
    sessionId,
    newSession,
    switchSession,
    renameSession,
    deleteSession,
    submitMessage,
    runCommand,
    handleConfirmAction,
    attachments,
    addAttachments,
    removeAttachment,
    isUploading,
  } = useAgentChat();

  const [showHistory, setShowHistory] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Overlay enter/exit: `shouldRender` gates the DOM, `shown` drives the
  // backdrop + input transitions.
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [shown, setShown] = useState(false);
  // Measured input-bar height, so the scroll region can be sized to exactly the
  // visible area above the floating input (see scrollMaxHeight).
  const [inputH, setInputH] = useState(52);

  // Swipe-to-dismiss. `dragY` is how far the sheet has been pulled down; while
  // `dragging` it drives BOTH layers inline (transitions off) so the drawer and
  // the floating input travel together instead of the input staying pinned
  // mid-screen. See onTouchStart for when a touch becomes a drag.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; lastY: number; lastT: number } | null>(
    null,
  );
  const dragLive = useRef(false);
  // Offset and velocity are read on touchend, which can beat the render that
  // would have refreshed them in a closure — so they live in refs.
  const dragOffset = useRef(0);
  const dragVelocity = useRef(0);

  if (isOpen && !shouldRender) setShouldRender(true);
  if (!isOpen && shown) setShown(false);

  // The drawer is part of opening the chat, not a reward for sending: it mounts
  // with the overlay and simply starts empty. That also puts the new-chat and
  // history buttons (which live in its header) within reach from a fresh chat.
  const drawerMounted = shouldRender;
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

  // Slide the drawer up a beat after it mounts, so it rises behind the input
  // rather than snapping in.
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

  // Keep the newest message in view as messages arrive, the keyboard toggles,
  // or the geometry shifts (all change how tall the scroll region is).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading, keyboardInset, inputH, drawerMounted]);

  // Leave no drag offset behind for the next open.
  useEffect(() => {
    if (isOpen) return;
    setDragging(false);
    setDragY(0);
  }, [isOpen]);

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

  // Uploads finish before a message can carry them, so the send button waits
  // rather than quietly sending without the file the user just picked.
  const canSend = !!inputValue.trim() && !isLoading && !isUploading && !!user;

  const send = () => {
    if (!canSend) return;
    submitMessage(inputValue.trim());
    setInputValue('');
    // Sending is a decision to be in the conversation, not to keep browsing.
    setShowHistory(false);
  };

  // A downward pull dismisses the sheet. It arms from the strip along the top
  // of the drawer — always draggable, the way a sheet's grab area is — or from
  // anywhere once the thread is scrolled to the top. Not mid-thread: scrolling
  // back up through a conversation must not throw the chat away, and the thread
  // sits scrolled to the bottom most of the time, so the top strip is the only
  // thing that makes the gesture reachable at all.
  const onDragStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const fromTopStrip =
      e.touches[0].clientY - e.currentTarget.getBoundingClientRect().top <
      DRAG_STRIP;
    if (!fromTopStrip && (scrollRef.current?.scrollTop ?? 0) > 0) return;
    const y = e.touches[0].clientY;
    dragStart.current = { y, lastY: y, lastT: e.timeStamp };
    dragOffset.current = 0;
    dragVelocity.current = 0;
  };

  const onDragMove = (e: React.TouchEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const y = e.touches[0].clientY;
    const dy = y - start.y;
    if (!dragLive.current) {
      // Wait for a deliberate downward pull, so a tap or a horizontal swipe
      // doesn't lurch the sheet.
      if (dy < 6) return;
      dragLive.current = true;
      setDragging(true);
      // One gesture, one outcome: the keyboard goes down with the sheet rather
      // than eating the first swipe.
      taRef.current?.blur();
    }
    const dt = e.timeStamp - start.lastT;
    if (dt > 0) dragVelocity.current = (y - start.lastY) / dt;
    start.lastY = y;
    start.lastT = e.timeStamp;
    dragOffset.current = Math.max(0, dy);
    setDragY(dragOffset.current);
  };

  const onDragEnd = () => {
    const wasLive = dragLive.current;
    dragStart.current = null;
    dragLive.current = false;
    if (!wasLive) return;
    // Drop the inline transform in the same commit as the close, so the drawer
    // transitions from where the finger left it rather than snapping back up
    // first.
    setDragging(false);
    setDragY(0);
    if (
      dragOffset.current > DISMISS_PX ||
      dragVelocity.current > DISMISS_VELOCITY
    ) {
      close();
    }
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
  // drawer height (85dvh) minus the space the input reserves. The corner
  // buttons take nothing off it — they float over the thread, which is padded
  // past them instead. An explicit max-height (not flex + a big
  // padding-bottom) is what iOS reliably bounds a scroll container by, so
  // scrolling engages as soon as the thread can't fit above the input — not
  // only once it fills the whole screen.
  const scrollMaxHeight =
    keyboardInset > 0
      ? `calc(85dvh - ${keyboardInset + 8 + inputH + GAP}px)`
      : `calc(85dvh - ${8 + inputH + GAP}px - env(safe-area-inset-bottom))`;

  // While dragging, both layers are driven inline with transitions off so they
  // track the finger; on release the classes take over again.
  const dragStyle = dragging
    ? { transform: `translateY(${dragY}px)`, transition: 'none' }
    : undefined;

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
          style={dragStyle}
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
          role="dialog"
          aria-label="Foreshadow AI chat"
        >
          {/* Floating chrome: history top-left, new chat top-right, with the
              thread running underneath and fading out behind them. Siblings of
              the scroll region, not children, so its fade mask leaves them
              alone. */}
          <button
            type="button"
            className={`${styles.cornerButton} ${styles.cornerLeft}${
              showHistory ? ` ${styles.cornerButtonActive}` : ''
            }`}
            onClick={() => setShowHistory((v) => !v)}
            aria-label="Chat history"
            aria-expanded={showHistory}
          >
            <History size={17} />
          </button>
          <button
            type="button"
            className={`${styles.cornerButton} ${styles.cornerRight}`}
            onClick={() => {
              newSession();
              setShowHistory(false);
            }}
            aria-label="New chat"
          >
            <SquarePen size={17} />
          </button>

          <div
            ref={scrollRef}
            className={styles.messagesScroll}
            style={{
              maxHeight: scrollMaxHeight,
              // Nothing to scroll mid-drag: the sheet is the thing moving, and
              // an iOS rubber-band underneath it reads as a second surface.
              overflowY: dragging ? 'hidden' : undefined,
            }}
          >
            <div className={styles.messages}>
              {showHistory && (
                <SessionList
                  sessions={sessions}
                  activeId={sessionId}
                  onSelect={(id) => {
                    void switchSession(id);
                    setShowHistory(false);
                  }}
                  onRename={renameSession}
                  onDelete={deleteSession}
                />
              )}
              {!showHistory && messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`${styles.row} ${
                    msg.role === 'user' ? styles.rowUser : styles.rowAssistant
                  }`}
                >
                  {msg.role === 'user' ? (
                    <div className={styles.userBubble}>
                      {msg.content}
                      {msg.attachments && (
                        <MessageAttachments attachments={msg.attachments} />
                      )}
                    </div>
                  ) : (
                    <div
                      className={`${styles.assistant}${
                        msg.variant === 'success'
                          ? ` ${styles.resultSuccess}`
                          : msg.variant === 'error'
                            ? ` ${styles.resultError}`
                            : ''
                      }`}
                    >
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
              {!showHistory && isLoading && (
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
        style={{
          bottom: keyboardInset,
          paddingBottom: inputPadBottom,
          ...dragStyle,
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
        <div ref={fieldRef} className={styles.field}>
          <ComposerAttachments
            attachments={attachments}
            onRemove={removeAttachment}
          />
          <div className={styles.fieldRow}>
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
              placeholder={
                !user
                  ? 'Sign in to chat'
                  : attachments.length > 0
                    ? 'Say what to do with it…'
                    : 'Ask the agent…'
              }
              aria-label="Ask the agent"
            />
            {/* iOS surfaces its own sheet here — Photo Library, Take Photo,
                Choose File — so no Capacitor plugin is involved. No accept
                filter: the destination decides what it will take. */}
            <button
              type="button"
              className={styles.attachButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={!user}
              aria-label="Attach a file"
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addAttachments(Array.from(e.target.files ?? []));
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <button
              type="button"
              className={styles.sendButton}
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
