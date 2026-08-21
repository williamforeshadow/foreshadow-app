'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  History,
  Maximize2,
  Minimize2,
  Paperclip,
  Search,
  SquarePen,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { AGENT_COMMANDS } from '@/src/lib/agentCommands';
import { useAiChat } from './AiChatProvider';
import { ProjectCard } from '@/components/windows/projects/ProjectCard';
import type { TaskRow } from '@/src/agent/tools/findTasks';
import { TaskAttachment } from './TaskAttachment';
import { taskRowToCardItem } from './taskCardMapping';
import {
  isSameOriginHref,
  toRelativeHref,
  useAgentChat,
  type AgentProposedTaskCard,
} from './useAgentChat';
import { ProposedTask } from '@/components/messages/ProposedTask';
import { ProposedTaskEditorOverlay } from '@/components/messages/ProposedTaskEditorOverlay';
import {
  ProposedKnowledge,
  type ProposedKnowledgeData,
} from '@/components/messages/ProposedKnowledge';
import { ComposerAttachments, MessageAttachments } from './ComposerAttachments';
import { SessionList } from './SessionList';
import styles from './AiChatPanel.module.css';

// The conversation itself — sending, confirming, attachments — lives in
// useAgentChat, shared with the mobile sheet. This component owns the docked
// panel's chrome and composer only.

const EXAMPLE_PROMPT = 'What needs my attention today?';

// Horizontally-scrollable task-card carousel. Attaches its wheel listener
// natively (non-passive) so it can preventDefault — without that, vertical
// wheel motion bleeds through to the chat body's vertical scroll while the
// cursor is over the carousel.
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
          className="w-[300px] shrink-0 cursor-pointer [&>div]:!cursor-pointer"
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

export function AiChatPanel() {
  const { user } = useAuth();
  const router = useRouter();
  const isMobile = useIsMobile() === true;
  const { isOpen, isFullscreen, close, toggleFullscreen, pendingPrompt, clearPendingPrompt } =
    useAiChat();
  const keyboardInset = useKeyboardInset();

  const {
    messages,
    isLoading,
    sessions,
    isHydrating,
    newSession,
    switchSession,
    renameSession,
    deleteSession,
    submitMessage,
    runCommand,
    handleConfirmAction,
    refreshProposals,
    refreshKnowledgeProposals,
    attachments,
    addAttachments,
    removeAttachment,
    isUploading,
  } = useAgentChat();

  // Agent task proposal being edited before acceptance. The overlay mounts the
  // standard CreateTaskPanel (same as the concierge inbox) and posts the edited
  // fields to the proposal-accept endpoint.
  const [editorProposal, setEditorProposal] =
    useState<AgentProposedTaskCard | null>(null);

  // Browsing chats is a mode, not a popover, and `searching` swaps the header
  // title for a filter field. Mirrors the mobile sheet so the two read alike.
  const [showHistory, setShowHistory] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Leaving the chats screen always drops the filter with it — coming back to a
  // list still narrowed by a search from two conversations ago reads as data
  // loss.
  const leaveHistory = useCallback(() => {
    setShowHistory(false);
    setSearching(false);
    setQuery('');
  }, []);

  // The composer clears itself; the hook owns the conversation, not the input.
  const send = useCallback(
    (text: string) => {
      void submitMessage(text);
      setInputValue('');
      // Sending is a decision to be in the conversation, not to keep browsing.
      leaveHistory();
    },
    [submitMessage, leaveHistory],
  );

  const runCommandAndClear = useCallback(
    (command: string) => {
      void runCommand(command);
      setInputValue('');
    },
    [runCommand],
  );

  const handleInternalNav = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
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
      router.push(toRelativeHref(href) as never);
    },
    [router],
  );

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
    [handleInternalNav],
  );

  // Auto-scroll to the latest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize the textarea. Cap at 200px so a long paste doesn't push
  // the input above the panel; beyond that the textarea scrolls
  // internally (styled in AiChatPanel.module.css to match the panel's
  // muted palette so the scrollbar isn't visually jarring).
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200,
      )}px`;
    }
  }, [inputValue]);

  // Whether the current open() carried a prompt (the mobile compose-then-open
  // flow). If so, skip auto-focus so the keyboard stays down and the answer is
  // readable. Derived at the open transition — state rather than a ref, so the
  // focus effect below re-runs with the right value instead of reading a value
  // mutated mid-render.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [skipFocus, setSkipFocus] = useState(false);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setSkipFocus(!!pendingPrompt);
  }

  // Focus the input when the panel opens (unless a prompt was submitted on open).
  useEffect(() => {
    if (!isOpen || skipFocus) return;
    const id = window.setTimeout(() => textareaRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [isOpen, skipFocus]);

  // Auto-submit a prompt handed to open() — the mobile compose-then-open flow,
  // where the pill's composer types the message and the panel appears with it
  // already sent. Deferred (not a synchronous setState in the effect body).
  useEffect(() => {
    if (!isOpen || !pendingPrompt) return;
    const prompt = pendingPrompt;
    const id = window.setTimeout(() => {
      submitMessage(prompt);
      clearPendingPrompt();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isOpen, pendingPrompt, submitMessage, clearPendingPrompt]);

  const canSend = !!inputValue.trim() && !isLoading && !isUploading && !!user;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) send(inputValue);
    }
  };

  // Pasting a screenshot straight into the composer is the fastest path from
  // "I just grabbed this" to "file it on the task", so treat pasted files the
  // same as picked ones. Text pastes fall through to the textarea untouched.
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    addAttachments(files);
  };

  // Slash-command autocomplete.
  const trimmedInput = inputValue.trim().toLowerCase();
  const commandMatches = trimmedInput.startsWith('/')
    ? AGENT_COMMANDS.filter((c) => c.name.startsWith(trimmedInput))
    : [];
  const showCommandMenu = commandMatches.length > 0 && !isLoading;

  const layoutClass = isMobile
    ? styles.mobile
    : isFullscreen
      ? styles.fullscreen
      : styles.docked;

  // Hydration counts as "not empty" so switching to a saved chat doesn't flash
  // the welcome screen on the way to its messages.
  const isEmpty = messages.length === 0 && !isLoading && !isHydrating;

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={`${styles.panel} ${layoutClass}`}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          // Mobile: pin the panel's bottom above the software keyboard so the
          // input isn't covered and the fixed panel doesn't slide up over black.
          style={isMobile ? { bottom: keyboardInset } : undefined}
          role="dialog"
          aria-label="Foreshadow AI chat"
        >
          <header className={styles.header}>
            {/* The header names what you're looking at. Browsing chats is a
                different screen, not a popover over the conversation, so it
                takes the title — and only then offers a way to search. */}
            {searching ? (
              <div className={styles.searchBar}>
                <Search size={14} className={styles.searchIcon} aria-hidden />
                <input
                  className={styles.searchInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats"
                  aria-label="Search chats"
                  autoFocus
                />
              </div>
            ) : (
              <span className={styles.title}>
                <Sparkles size={14} className={styles.titleIcon} />
                {showHistory ? 'Chats' : 'Ask Foreshadow'}
              </span>
            )}
            <div className={styles.headerActions}>
              {showHistory && (
                <button
                  type="button"
                  className={`${styles.iconButton}${searching ? ` ${styles.iconButtonActive}` : ''}`}
                  onClick={() => {
                    if (searching) {
                      setSearching(false);
                      setQuery('');
                    } else {
                      setSearching(true);
                    }
                  }}
                  title={searching ? 'Close search' : 'Search chats'}
                  aria-label={searching ? 'Close search' : 'Search chats'}
                >
                  {searching ? <X size={15} /> : <Search size={15} />}
                </button>
              )}
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  newSession();
                  leaveHistory();
                }}
                title="New chat"
                aria-label="New chat"
              >
                <SquarePen size={15} />
              </button>
              <button
                type="button"
                className={`${styles.iconButton}${showHistory ? ` ${styles.iconButtonActive}` : ''}`}
                onClick={() => {
                  if (showHistory) leaveHistory();
                  else setShowHistory(true);
                }}
                title="Chat history"
                aria-label="Chat history"
                aria-expanded={showHistory}
              >
                <History size={15} />
              </button>
              {!isMobile && (
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                >
                  {isFullscreen ? (
                    <Minimize2 size={15} />
                  ) : (
                    <Maximize2 size={15} />
                  )}
                </button>
              )}
              <button
                type="button"
                className={styles.iconButton}
                onClick={close}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          <div className={styles.body}>
            <div className={styles.bodyInner}>
              {showHistory ? (
                <SessionList
                  sessions={sessions}
                  query={query}
                  onSelect={(id) => {
                    void switchSession(id);
                    leaveHistory();
                  }}
                  onRename={renameSession}
                  onDelete={deleteSession}
                />
              ) : isEmpty ? (
                <div className={styles.welcome}>
                  <div className={styles.welcomeIcon}>
                    <Sparkles size={20} />
                  </div>
                  <p className={styles.welcomeTitle}>Ask Foreshadow</p>
                  <p className={styles.welcomeText}>
                    Ask about your properties, reservations, and tasks — or
                    have me make changes for you.
                  </p>
                  <div className={styles.chips}>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => runCommandAndClear('/myassignments')}
                    >
                      My assignments
                    </button>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => runCommandAndClear('/dailyoutlook')}
                    >
                      Daily outlook
                    </button>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => send(EXAMPLE_PROMPT)}
                    >
                      {EXAMPLE_PROMPT}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.messagesContainer}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`${styles.messageRow} ${
                        msg.role === 'user'
                          ? styles.userMessage
                          : styles.assistantMessage
                      }${
                        msg.variant === 'success'
                          ? ` ${styles.resultSuccess}`
                          : msg.variant === 'error'
                            ? ` ${styles.resultError}`
                            : ''
                      }`}
                    >
                      <div className={styles.messageContent}>
                        {msg.role === 'assistant' ? (
                          <>
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                            {msg.tasks &&
                              (() => {
                                const cards = msg.tasks;
                                if (cards.length === 0) return null;
                                const onOpen = (url: string) =>
                                  router.push(toRelativeHref(url) as never);
                                // Small-N: keep the inline carousel as a
                                // glanceable convenience. Above the
                                // threshold, switch to a collapsible
                                // attachment so the chat stays compact and
                                // the user expands to see every card.
                                if (cards.length <= 5) {
                                  return (
                                    <TaskCardCarousel
                                      cards={cards}
                                      onOpen={onOpen}
                                    />
                                  );
                                }
                                return (
                                  <TaskAttachment
                                    cards={cards}
                                    onOpen={onOpen}
                                  />
                                );
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
                                    onChanged={() =>
                                      void refreshProposals([p.id])
                                    }
                                  />
                                ))}
                              </div>
                            )}
                            {msg.knowledgeProposals &&
                              msg.knowledgeProposals.length > 0 && (
                                <div className="flex flex-col">
                                  {msg.knowledgeProposals.map((p) => (
                                    <ProposedKnowledge
                                      key={p.id}
                                      // Card shape is a superset of the bubble's
                                      // data type; target rides through as-is.
                                      proposal={p as unknown as ProposedKnowledgeData}
                                      propertyId={p.property_id}
                                      align="start"
                                      onChanged={() =>
                                        void refreshKnowledgeProposals([p.id])
                                      }
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
                          </>
                        ) : (
                          <>
                            <p>{msg.content}</p>
                            {msg.attachments && (
                              <MessageAttachments attachments={msg.attachments} />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div
                      className={`${styles.messageRow} ${styles.assistantMessage}`}
                    >
                      <div className={styles.messageContent}>
                        <div className={styles.loadingDots}>
                          <span className={styles.loadingDot} />
                          <span className={styles.loadingDot} />
                          <span className={styles.loadingDot} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <div className={styles.footerInner}>
              {showCommandMenu && (
                <div className={styles.commandMenu}>
                  {commandMatches.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className={styles.commandMenuItem}
                      onClick={() => runCommandAndClear(c.name)}
                    >
                      <span className={styles.commandName}>{c.name}</span>
                      <span className={styles.commandDesc}>
                        {c.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <ComposerAttachments
                attachments={attachments}
                onRemove={removeAttachment}
              />
              <div className={styles.inputBox}>
                <button
                  type="button"
                  className={styles.attachButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!user}
                  title="Attach a file"
                  aria-label="Attach a file"
                >
                  <Paperclip size={15} />
                </button>
                {/* No accept filter: the agent files whatever the user thinks
                    is worth filing, and the destination enforces its own rules
                    at commit time. */}
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
                <textarea
                  ref={textareaRef}
                  className={styles.textarea}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={
                    !user
                      ? 'Sign in to chat'
                      : attachments.length > 0
                        ? 'Say what to do with it…'
                        : 'Ask anything, or type / for commands…'
                  }
                  rows={1}
                />
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={() => send(inputValue)}
                  disabled={!canSend}
                  title={isUploading ? 'Waiting for upload…' : 'Send'}
                >
                  <ArrowUp size={15} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
