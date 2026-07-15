'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/authContext';
import { AGENT_COMMANDS } from '@/src/lib/agentCommands';
import type { TaskRow } from '@/src/agent/tools/findTasks';

// The agent conversation, lifted out of AiChatPanel so a second surface (the
// mobile bottom-sheet chat) can drive the same wiring — /api/agent for free
// text, /api/agent/command for slash commands, /api/agent/confirm for previewed
// writes — without the desktop panel and the mobile sheet drifting apart.
//
// The desktop AiChatPanel still carries its own inline copy for now; this hook
// is the shared home going forward.

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // Every pending action this turn registered. The chat shows a SINGLE
  // Confirm/Cancel pair below the message; clicking commits (or cancels)
  // every id in this array together via /api/agent/confirm.
  pendingActionIds?: string[];
  confirmation?: 'pending' | 'confirming' | 'done' | 'cancelled' | 'error';
  // Structured task rows from any find_tasks call this turn. The tasks the
  // answer actually links to render as cards below the text.
  tasks?: TaskRow[];
}

// Same-origin link interception: the agent emits markdown links to in-app
// routes (e.g. /tasks/<uuid>). Callers route these through Next's client router
// so clicking one doesn't hard-reload the page and drop the chat.
export function isSameOriginHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    return new URL(href, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function toRelativeHref(href: string): string {
  if (href.startsWith('/')) return href;
  if (typeof window === 'undefined') return href;
  try {
    const u = new URL(href, window.location.origin);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return href;
  }
}

// Pick the tasks the answer text actually references — matched by the
// /tasks/<id> deep link the agent emits — ordered by where they appear in the
// prose so the card stack reads top-to-bottom with the text.
export function referencedTasks(content: string, tasks: TaskRow[]): TaskRow[] {
  return tasks
    .map((t) => ({ t, idx: content.indexOf(`/tasks/${t.task_id}`) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.t);
}

export interface UseAgentChat {
  messages: AgentMessage[];
  isLoading: boolean;
  /** Send free text to the agent (routes to a slash command when it matches). */
  submitMessage: (text: string) => Promise<void>;
  /** Run a deterministic slash command (no LLM turn). */
  runCommand: (command: string) => Promise<void>;
  /** Confirm or cancel previewed writes registered this turn. */
  handleConfirmAction: (
    messageId: string,
    pendingActionIds: string[],
    action: 'confirm' | 'cancel',
  ) => Promise<void>;
}

export function useAgentChat(): UseAgentChat {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const runCommand = useCallback(
    async (command: string) => {
      if (!user || isLoading) return;
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content: command },
      ]);
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
        state: NonNullable<AgentMessage['confirmation']>,
        resultText: string,
      ) => {
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === messageId ? { ...m, confirmation: state } : m,
          ),
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: resultText,
          },
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
        const resolved: NonNullable<AgentMessage['confirmation']> =
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

  return { messages, isLoading, submitMessage, runCommand, handleConfirmAction };
}
