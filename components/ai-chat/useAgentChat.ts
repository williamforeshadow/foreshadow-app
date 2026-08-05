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
  /**
   * Status colouring for a committed/cancelled/failed result message.
   * Green means the write landed — the same meaning --task-green carries
   * in the task panel, not a decorative accent.
   */
  variant?: 'success' | 'error';
  // Structured task rows from any find_tasks call this turn. The tasks the
  // answer actually links to render as cards below the text.
  tasks?: TaskRow[];
  // Files sent with a user message, echoed back into the bubble so the thread
  // shows what was attached where.
  attachments?: { id: string; name: string }[];
}

/**
 * A file in the composer, from the moment it's picked to the moment it's sent.
 *
 * Uploading happens on pick, not on send: by the time the user hits send the
 * bytes are already staged and the message carries nothing but ids. That keeps
 * send fast and lets a failed upload surface while there's still something to
 * do about it.
 */
export interface ComposerAttachment {
  /** Stable local key. Survives the upload, unlike the server id. */
  key: string;
  /** inbound_file_id once staged; null while in flight or after a failure. */
  id: string | null;
  name: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

let attachmentKeySeq = 0;

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
  /** Files staged for the next message. */
  attachments: ComposerAttachment[];
  /** Stage picked files immediately; they upload in the background. */
  addAttachments: (files: File[]) => void;
  /** Drop one from the composer, deleting it server-side if it landed. */
  removeAttachment: (key: string) => void;
  /** True while any pick is still uploading — send waits for it. */
  isUploading: boolean;
}

export function useAgentChat(): UseAgentChat {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const isUploading = attachments.some((a) => a.status === 'uploading');

  const addAttachments = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const picked = files.map((file) => ({
      entry: {
        key: `att-${Date.now()}-${attachmentKeySeq++}`,
        id: null,
        name: file.name || 'upload',
        size: file.size,
        status: 'uploading' as const,
      },
      file,
    }));
    setAttachments((prev) => [...prev, ...picked.map((p) => p.entry)]);

    // One request per file so a single rejection (too large, storage hiccup)
    // marks only its own chip instead of failing the whole selection.
    for (const { entry, file } of picked) {
      const body = new FormData();
      body.append('file', file);
      void (async () => {
        try {
          const res = await fetch('/api/agent/attachments', {
            method: 'POST',
            body,
          });
          const data = await res.json();
          const staged = Array.isArray(data?.attachments)
            ? data.attachments[0]
            : null;
          if (!res.ok || data?.error || !staged?.id) {
            throw new Error(data?.error || 'Upload failed');
          }
          setAttachments((prev) =>
            prev.map((a) =>
              a.key === entry.key
                ? { ...a, id: staged.id, status: 'ready' as const }
                : a,
            ),
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.key === entry.key
                ? {
                    ...a,
                    status: 'error' as const,
                    error: err instanceof Error ? err.message : 'Upload failed',
                  }
                : a,
            ),
          );
        }
      })();
    }
  }, []);

  const removeAttachment = useCallback((key: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.key === key);
      // Best-effort cleanup of the staged copy. If it fails the row is simply
      // left unconsumed and ages out of the carry-forward window; nothing the
      // user needs to hear about.
      if (target?.id) {
        void fetch(
          `/api/agent/attachments?id=${encodeURIComponent(target.id)}`,
          { method: 'DELETE' },
        ).catch(() => {});
      }
      return prev.filter((a) => a.key !== key);
    });
  }, []);

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

      // Only fully-staged files ride along. Anything still uploading or failed
      // is left in the composer rather than silently dropped from a message
      // the user thinks carried it.
      const sending = attachments.filter(
        (a): a is ComposerAttachment & { id: string } =>
          a.status === 'ready' && !!a.id,
      );

      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: message,
          ...(sending.length > 0
            ? {
                attachments: sending.map((a) => ({ id: a.id, name: a.name })),
              }
            : {}),
        },
      ]);
      setAttachments((prev) => prev.filter((a) => a.status !== 'ready'));
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
            ...(sending.length > 0
              ? { inbound_file_ids: sending.map((a) => a.id) }
              : {}),
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
    [user, isLoading, runCommand, attachments],
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
        // Present when the agent had registered a dependent next step
        // (declare_followup) and the server ran it after the commit landed.
        continuation?: { text: string; pending_action_ids?: string[] },
      ) => {
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === messageId ? { ...m, confirmation: state } : m,
          ),
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: resultText,
            variant: state === 'done' ? 'success' : state === 'error' ? 'error' : undefined,
          },
          // Its own message, carrying its own Confirm/Cancel pair when the
          // continuation previewed further writes.
          ...(continuation
            ? [
                {
                  id: `assistant-${Date.now()}-cont`,
                  role: 'assistant' as const,
                  content: continuation.text,
                  // 'pending' is what gates the Confirm/Cancel pair in the
                  // renderer; without it a continuation that previewed further
                  // writes would show no buttons at all.
                  ...(continuation.pending_action_ids?.length
                    ? {
                        pendingActionIds: continuation.pending_action_ids,
                        confirmation: 'pending' as const,
                      }
                    : {}),
                },
              ]
            : []),
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
        settle(resolved, data.text, data.continuation);
      } catch (err) {
        settle(
          'error',
          `Error: ${err instanceof Error ? err.message : 'Failed to confirm'}`,
        );
      }
    },
    [user],
  );

  return {
    messages,
    isLoading,
    submitMessage,
    runCommand,
    handleConfirmAction,
    attachments,
    addAttachments,
    removeAttachment,
    isUploading,
  };
}
