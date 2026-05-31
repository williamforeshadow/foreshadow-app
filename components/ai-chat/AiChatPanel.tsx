'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { AGENT_COMMANDS } from '@/src/lib/agentCommands';
import { useAiChat } from './AiChatProvider';
import { ProjectCard } from '@/components/windows/projects/ProjectCard';
import type { TaskRow } from '@/src/agent/tools/findTasks';
import { TaskAttachment } from './TaskAttachment';
import { taskRowToCardItem } from './taskCardMapping';
import styles from './AiChatPanel.module.css';

// Same-origin link interception: the agent emits markdown links to in-app
// routes (e.g. /tasks/<uuid>). Route those through Next's client router so
// clicking one doesn't hard-reload the page and drop the chat.
function isSameOriginHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    return new URL(href, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function toRelativeHref(href: string): string {
  if (href.startsWith('/')) return href;
  if (typeof window === 'undefined') return href;
  try {
    const u = new URL(href, window.location.origin);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return href;
  }
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // When the agent returns a write preview, the server hands back a durable
  // pending-action id; the chat shows Confirm/Cancel until it's resolved.
  // Every pending action this turn registered. The chat shows a SINGLE
  // Confirm/Cancel pair below the message; clicking commits (or cancels)
  // every id in this array together via /api/agent/confirm.
  pendingActionIds?: string[];
  confirmation?: 'pending' | 'confirming' | 'done' | 'cancelled' | 'error';
  // Structured task rows from any find_tasks call this turn. The tasks the
  // answer actually links to render as kanban-style cards below the text.
  tasks?: TaskRow[];
}

// Pick the tasks the answer text actually references — matched by the
// /tasks/<id> deep link the agent emits — ordered by where they appear in
// the prose so the card stack reads top-to-bottom with the text.
function referencedTasks(content: string, tasks: TaskRow[]): TaskRow[] {
  return tasks
    .map((t) => ({ t, idx: content.indexOf(`/tasks/${t.task_id}`) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.t);
}

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
  const { isOpen, isFullscreen, close, toggleFullscreen } = useAiChat();

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Focus the input when the panel opens.
  useEffect(() => {
    if (isOpen) {
      const id = window.setTimeout(() => textareaRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  // Run a deterministic slash command (e.g. /myassignments) — no LLM.
  const runCommand = useCallback(
    async (command: string) => {
      if (!user || isLoading) return;
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content: command },
      ]);
      setInputValue('');
      setIsLoading(true);
      try {
        const res = await fetch('/api/agent/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, user_id: user.id }),
        });
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content:
              !res.ok || data.error
                ? `Error: ${data.error || 'Something went wrong'}`
                : data.answer,
            tasks:
              !res.ok || data.error || !Array.isArray(data.tasks)
                ? undefined
                : data.tasks,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${
              err instanceof Error ? err.message : 'Failed to run command'
            }`,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [user, isLoading],
  );

  // Send a free-text prompt to the agent (or route a known slash command).
  const submitMessage = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || isLoading || !user) return;

      if (message.startsWith('/')) {
        const lower = message.toLowerCase();
        const cmd =
          AGENT_COMMANDS.find((c) => c.name === lower) ??
          AGENT_COMMANDS.find((c) => c.name.startsWith(lower));
        if (cmd) {
          runCommand(cmd.name);
          return;
        }
      }

      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content: message },
      ]);
      setInputValue('');
      setIsLoading(true);

      try {
        let clientTz: string | undefined;
        try {
          clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          clientTz = undefined;
        }

        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: message,
            user_id: user.id,
            client_tz: clientTz,
          }),
        });
        const data = await res.json();

        if (!res.ok || data.error) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${data.error || 'Something went wrong'}`,
            },
          ]);
        } else {
          const ids: string[] = Array.isArray(data.pending_action_ids)
            ? data.pending_action_ids.filter(
                (v: unknown): v is string =>
                  typeof v === 'string' && v.length > 0,
              )
            : [];
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: data.answer,
              pendingActionIds: ids.length > 0 ? ids : undefined,
              confirmation: ids.length > 0 ? 'pending' : undefined,
              tasks: Array.isArray(data.tasks) ? data.tasks : undefined,
            },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${
              err instanceof Error ? err.message : 'Failed to get response'
            }`,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [user, isLoading, runCommand],
  );

  // Confirm or cancel previewed writes — commits server-side, no LLM turn.
  // Takes the full array of pending action ids registered this turn; the
  // server loops them in order and reports a single combined result.
  const handleConfirmAction = useCallback(
    async (
      messageId: string,
      pendingActionIds: string[],
      action: 'confirm' | 'cancel',
    ) => {
      if (!user || pendingActionIds.length === 0) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, confirmation: 'confirming' } : m,
        ),
      );

      const settle = (
        state: NonNullable<Message['confirmation']>,
        resultText: string,
      ) => {
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === messageId ? { ...m, confirmation: state } : m,
          ),
          { id: `assistant-${Date.now()}`, role: 'assistant', content: resultText },
        ]);
      };

      try {
        const res = await fetch('/api/agent/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pending_action_ids: pendingActionIds,
            action,
            user_id: user.id,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          settle('error', `Error: ${data.error || 'Something went wrong'}`);
          return;
        }
        const resolved: NonNullable<Message['confirmation']> =
          data.status === 'committed'
            ? 'done'
            : data.status === 'cancelled'
              ? 'cancelled'
              : 'error';
        settle(resolved, data.text);
      } catch (err) {
        settle(
          'error',
          `Error: ${err instanceof Error ? err.message : 'Failed to confirm'}`,
        );
      }
    },
    [user],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage(inputValue);
    }
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

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={`${styles.panel} ${layoutClass}`}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          role="dialog"
          aria-label="Foreshadow AI chat"
        >
          <header className={styles.header}>
            <span className={styles.title}>
              <Sparkles size={14} className={styles.titleIcon} />
              Ask Foreshadow
            </span>
            <div className={styles.headerActions}>
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
              {isEmpty ? (
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
                <div className={styles.messagesContainer}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`${styles.messageRow} ${
                        msg.role === 'user'
                          ? styles.userMessage
                          : styles.assistantMessage
                      }`}
                    >
                      <div className={styles.messageContent}>
                        {msg.role === 'assistant' ? (
                          <>
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
                          <p>{msg.content}</p>
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
                      onClick={() => runCommand(c.name)}
                    >
                      <span className={styles.commandName}>{c.name}</span>
                      <span className={styles.commandDesc}>
                        {c.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.inputBox}>
                <textarea
                  ref={textareaRef}
                  className={styles.textarea}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    user
                      ? 'Ask anything, or type / for commands…'
                      : 'Sign in to chat'
                  }
                  rows={1}
                />
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={() => submitMessage(inputValue)}
                  disabled={isLoading || !inputValue.trim() || !user}
                  title="Send"
                >
                  <ArrowUp size={15} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
