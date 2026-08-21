'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import {
  ArrowUp,
  History,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  SquarePen,
  X,
} from 'lucide-react';
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
  toRelativeHref,
  useAgentChat,
  type AgentProposedTaskCard,
} from '@/components/ai-chat/useAgentChat';
import { ProposedTask } from '@/components/messages/ProposedTask';
import { ProposedTaskEditorOverlay } from '@/components/messages/ProposedTaskEditorOverlay';
import { TaskAttachment } from '@/components/ai-chat/TaskAttachment';
import { MobileSessionList } from './MobileSessionList';
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
// What the New chat pill reserves at the bottom of the chats screen.
const NEW_CHAT_H = 64;

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
    newSession,
    switchSession,
    renameSession,
    deleteSession,
    submitMessage,
    runCommand,
    handleConfirmAction,
    refreshProposals,
    attachments,
    addAttachments,
    removeAttachment,
    isUploading,
  } = useAgentChat();

  // Agent task proposal being edited before acceptance (standard create-task
  // form, posting to the proposal-accept endpoint). Mirrors AiChatPanel.
  const [editorProposal, setEditorProposal] =
    useState<AgentProposedTaskCard | null>(null);

  // The chats screen is a mode, not a popover: it takes the whole drawer, and
  // `searching` swaps its top strip for a filter field.
  const [showHistory, setShowHistory] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Measured input-bar height, so the scroll region can be sized to exactly the
  // visible area above the floating input (see scrollMaxHeight).
  const [inputH, setInputH] = useState(52);

  // Enter/exit animation, swipe-to-dismiss (with velocity + rubber-band),
  // scrim tap, and body scroll locking are all vaul's job now — the drawer is
  // a controlled <Drawer.Root>, so this component only owns what's inside it.

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
    // The chats screen unmounts the input entirely, so the observer has to be
    // re-attached to the new element on the way back — not left watching a node
    // that's no longer in the document.
  }, [isOpen, showHistory]);

  // Keep the newest message in view as messages arrive, the keyboard toggles,
  // or the geometry shifts (all change how tall the scroll region is).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading, keyboardInset, inputH, isOpen]);

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

  // Leaving the chats screen always drops the filter with it — coming back to a
  // list still narrowed by a search from two conversations ago reads as data
  // loss.
  const leaveHistory = () => {
    setShowHistory(false);
    setSearching(false);
    setQuery('');
  };

  const send = () => {
    if (!canSend) return;
    submitMessage(inputValue.trim());
    setInputValue('');
    // Sending is a decision to be in the conversation, not to keep browsing.
    leaveHistory();
  };

  const trimmedInput = inputValue.trim().toLowerCase();
  const commandMatches = trimmedInput.startsWith('/')
    ? AGENT_COMMANDS.filter((c) => c.name.startsWith(trimmedInput))
    : [];
  const showCommandMenu = commandMatches.length > 0 && !isLoading;

  if (isMobile !== true) return null;

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
  // The chats screen has no composer — a text box implies a conversation to
  // type into, and none is selected — so what the bottom reserves there is the
  // New chat pill instead.
  const bottomReserve = showHistory ? NEW_CHAT_H : 8 + inputH + GAP;
  const scrollMaxHeight =
    keyboardInset > 0
      ? `calc(85dvh - ${keyboardInset + bottomReserve}px)`
      : `calc(85dvh - ${bottomReserve}px - env(safe-area-inset-bottom))`;

  return (
    <>
      {editorProposal && (
        <ProposedTaskEditorOverlay
          proposal={editorProposal}
          propertyId={editorProposal.property_id}
          propertyName={editorProposal.property_name}
          onClose={() => setEditorProposal(null)}
          onCreated={() => void refreshProposals([editorProposal.id])}
        />
      )}
    <Drawer.Root
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      // The app's Capacitor keyboard system owns input repositioning (the
      // floating input tracks the inset itself); vaul must not fight it.
      repositionInputs={false}
      // One gesture, one outcome: the keyboard goes down with the sheet
      // rather than eating the first swipe.
      onDrag={() => {
        if (document.activeElement === taRef.current) taRef.current?.blur();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className={styles.backdrop} onClick={close} />
        <Drawer.Content
          className={styles.drawer}
          aria-describedby={undefined}
          aria-label="Foreshadow AI chat"
          // The timed effect above focuses the input deliberately; Radix's
          // open-autofocus would race it (and the keyboard choreography).
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Escape backs out one layer at a time — search, then the chats
          // screen, then (via Radix's default) the chat itself.
          onEscapeKeyDown={(e) => {
            if (searching) {
              e.preventDefault();
              setSearching(false);
              setQuery('');
            } else if (showHistory) {
              e.preventDefault();
              setShowHistory(false);
            }
          }}
        >
          <Drawer.Title className="sr-only">Foreshadow AI chat</Drawer.Title>
          {/* Floating chrome: history top-left, with the thread running
              underneath and fading out behind it. Siblings of the scroll
              region, not children, so its fade mask leaves them alone.
              The right corner is new-chat in the conversation and search on the
              chats screen, where new-chat moves to the pill at the bottom. */}
          {searching ? (
            <div className={styles.searchBar}>
              <Search size={16} className={styles.searchIcon} aria-hidden />
              <input
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                autoFocus
              />
              <button
                type="button"
                className={styles.searchClose}
                onClick={() => {
                  setSearching(false);
                  setQuery('');
                }}
                aria-label="Close search"
              >
                <X size={17} />
              </button>
            </div>
          ) : (
            <>
              {/* On the chats screen the left corner names the screen instead
                  of offering a way to it — you're already here. Getting back to
                  a conversation is tapping one, including the one you left. */}
              {showHistory ? (
                <h2 className={styles.screenTitle}>Chats</h2>
              ) : (
                <button
                  type="button"
                  className={`${styles.cornerButton} ${styles.cornerLeft}`}
                  onClick={() => {
                    setShowHistory(true);
                    // Browsing isn't typing; the keyboard has no business
                    // covering half the list.
                    taRef.current?.blur();
                  }}
                  aria-label="Chat history"
                  aria-expanded={false}
                >
                  <History size={19} />
                </button>
              )}
              <button
                type="button"
                className={`${styles.cornerButton} ${styles.cornerRight}`}
                onClick={() => {
                  if (showHistory) {
                    setSearching(true);
                  } else {
                    newSession();
                    leaveHistory();
                  }
                }}
                aria-label={showHistory ? 'Search chats' : 'New chat'}
              >
                {showHistory ? <Search size={19} /> : <SquarePen size={19} />}
              </button>
            </>
          )}

          <div
            ref={scrollRef}
            className={`${styles.messagesScroll}${
              searching ? ` ${styles.messagesScrollSearching}` : ''
            }`}
            style={{
              maxHeight: scrollMaxHeight,
            }}
          >
            <div className={styles.messages}>
              {showHistory && (
                <MobileSessionList
                  sessions={sessions}
                  query={query}
                  onSelect={(id) => {
                    void switchSession(id);
                    leaveHistory();
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
                          const cards = msg.tasks;
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
                      {msg.proposals && msg.proposals.length > 0 && (
                        <div className="flex flex-col">
                          {msg.proposals.map((p) => (
                            <ProposedTask
                              key={p.id}
                              proposal={p}
                              propertyName={p.property_name}
                              align="start"
                              onOpenEditor={() => setEditorProposal(p)}
                              onChanged={() => void refreshProposals([p.id])}
                            />
                          ))}
                        </div>
                      )}
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

          {/* The chats screen gets a New chat pill where the composer would
              be. A composer there would invite typing into a conversation that
              hasn't been chosen yet. Both bottom layers live INSIDE the vaul
              content (absolute, not fixed) so they ride the drawer's drag. */}
          {showHistory && (
            <div
              className={`${styles.inputWrap} ${styles.newChatWrap}`}
              style={{
                bottom: keyboardInset,
                paddingBottom: inputPadBottom,
              }}
            >
          <button
            type="button"
            className={styles.newChatPill}
            onClick={() => {
              newSession();
              leaveHistory();
            }}
          >
            <Plus size={18} />
            New chat
          </button>
        </div>
      )}

          {/* Floating input — its own layer pinned above the keyboard,
              absolutely positioned within the drawer so it travels with it.
              pointer-events pass through the wrapper so taps beside the field
              fall through. */}
          {!showHistory && (
            <div
              className={styles.inputWrap}
              style={{
                bottom: keyboardInset,
                paddingBottom: inputPadBottom,
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
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
    </>
  );
}
