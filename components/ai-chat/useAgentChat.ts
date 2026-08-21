'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/authContext';
import { AGENT_COMMANDS } from '@/src/lib/agentCommands';
import type { TaskRow } from '@/src/agent/tools/findTasks';
import type { SessionSummary } from '@/src/server/agent/sessions';
import type { AgentProposedTaskCard } from '@/src/server/agent/proposedTaskCards';

export type { AgentProposedTaskCard };

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
  // Durable task proposals registered this turn (propose_task). Each renders
  // as a ProposedTask card with its own Create/Dismiss controls; deciding one
  // goes through /api/proposed-tasks/[id], not the confirm endpoint.
  proposals?: AgentProposedTaskCard[];
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

// Found-task cards render straight from msg.tasks (the last find_tasks call's
// rows) — rendering is decoupled from the reply text, so the model neither
// controls nor can break which cards appear. The old referencedTasks() gate
// (render only tasks whose /tasks/<id> link appeared in the prose) is gone
// with the prompt rules that fed it.

export type { SessionSummary };

export interface UseAgentChat {
  messages: AgentMessage[];
  isLoading: boolean;
  /** The user's saved conversations, newest activity first. */
  sessions: SessionSummary[];
  /** The conversation on screen. Null before the first message creates one. */
  sessionId: string | null;
  /** True while a switched-to conversation is being fetched. */
  isHydrating: boolean;
  /** Clear the panel and start fresh. The row is created by the first message. */
  newSession: () => void;
  /** Load a saved conversation into the panel. */
  switchSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
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
  /**
   * Re-fetch the given proposal cards after an accept/dismiss and patch them
   * into whichever messages carry them. Accepted proposals become tombstones;
   * dismissed ones disappear.
   */
  refreshProposals: (proposalIds: string[]) => Promise<void>;
  /** Files staged for the next message. */
  attachments: ComposerAttachment[];
  /** Stage picked files immediately; they upload in the background. */
  addAttachments: (files: File[]) => void;
  /** Drop one from the composer, deleting it server-side if it landed. */
  removeAttachment: (key: string) => void;
  /** True while any pick is still uploading — send waits for it. */
  isUploading: boolean;
}

/** Turn a rehydrated row into the shape the renderer already understands. */
function toAgentMessage(raw: HydratedMessageDto): AgentMessage {
  const pendingActionIds =
    Array.isArray(raw.pending_action_ids) && raw.pending_action_ids.length > 0
      ? raw.pending_action_ids
      : undefined;
  return {
    id: raw.id,
    role: raw.role,
    content: raw.content,
    ...(raw.attachments?.length ? { attachments: raw.attachments } : {}),
    ...(raw.variant ? { variant: raw.variant } : {}),
    // Only actions the server confirmed are still live come back with ids, so
    // 'pending' here always means a button that will really commit something.
    ...(pendingActionIds
      ? { pendingActionIds, confirmation: 'pending' as const }
      : {}),
    ...(raw.proposed_tasks?.length ? { proposals: raw.proposed_tasks } : {}),
    ...(raw.tasks?.length ? { tasks: raw.tasks } : {}),
  };
}

interface HydratedMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: { id: string; name: string }[];
  pending_action_ids?: string[];
  proposed_tasks?: AgentProposedTaskCard[];
  tasks?: TaskRow[];
  variant?: 'success' | 'error';
}

export function useAgentChat(): UseAgentChat {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(false);
  const isUploading = attachments.some((a) => a.status === 'uploading');

  // Guards the hydration effect against a race: switching conversations (or
  // starting a new one) while an older fetch is still in flight must not let
  // that fetch paint stale messages over the newer choice.
  const activeLoad = useRef(0);

  // "This blank panel is a conversation the user started, not one we haven't
  // looked up yet." A null sessionId means both things, and the server treats
  // them differently — without this the first message of every new chat gets
  // appended to the previous one. A ref rather than state: nothing renders
  // from it, and submitMessage must read the value at send time rather than
  // whatever its closure captured.
  const startingNewSession = useRef(false);

  const refreshSessions = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const res = await fetch('/api/agent/sessions');
      if (!res.ok) return [];
      const data = await res.json();
      const list: SessionSummary[] = Array.isArray(data?.sessions)
        ? data.sessions
        : [];
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const hydrate = useCallback(async (id: string) => {
    const token = ++activeLoad.current;
    setIsHydrating(true);
    try {
      const res = await fetch(`/api/agent/sessions/${id}/messages`);
      const data = await res.json();
      if (token !== activeLoad.current) return;
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const raw: HydratedMessageDto[] = Array.isArray(data?.messages)
        ? data.messages
        : [];
      setMessages(raw.map(toAgentMessage));
    } catch {
      if (token === activeLoad.current) setMessages([]);
    } finally {
      if (token === activeLoad.current) setIsHydrating(false);
    }
  }, []);

  // On sign-in, restore the conversation the user was last in. Before this the
  // server kept remembering conversations the browser discarded on refresh —
  // the agent knew what you'd said and the screen didn't.
  useEffect(() => {
    if (!user) {
      setSessions([]);
      setSessionId(null);
      setMessages([]);
      startingNewSession.current = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await refreshSessions();
      if (cancelled || list.length === 0) return;
      // Don't adopt the most recent if the user got ahead of this fetch and
      // opened a new chat. Both states read as a null sessionId, so the id
      // alone can't tell them apart — that's what the ref is for.
      if (startingNewSession.current) return;
      setSessionId((current) => {
        if (current !== null) return current;
        void hydrate(list[0].id);
        return list[0].id;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refreshSessions, hydrate]);

  const newSession = useCallback(() => {
    // Purely local — no row until the first message. Bumping the load token
    // cancels any hydration still in flight so it can't repaint this.
    activeLoad.current++;
    startingNewSession.current = true;
    setIsHydrating(false);
    setSessionId(null);
    setMessages([]);
  }, []);

  const switchSession = useCallback(
    async (id: string) => {
      if (id === sessionId) return;
      // Opening a saved conversation cancels a pending new one; otherwise the
      // next message would open a third.
      startingNewSession.current = false;
      setSessionId(id);
      setMessages([]);
      await hydrate(id);
    },
    [sessionId, hydrate],
  );

  const renameSession = useCallback(async (id: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    // Optimistic: the list is the user's own text echoed back, and a failed
    // rename is recoverable by trying again.
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: clean } : s)),
    );
    try {
      await fetch(`/api/agent/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: clean }),
      });
    } catch {
      /* leave the optimistic title; the next refresh corrects it */
    }
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      // Deleting the conversation you're looking at empties the panel; the
      // alternative (silently jumping to another one) loses your place. What's
      // left reads as a new chat, so it has to behave as one — otherwise the
      // next message lands in whatever conversation happens to be newest.
      if (id === sessionId) {
        activeLoad.current++;
        startingNewSession.current = true;
        setSessionId(null);
        setMessages([]);
      }
      try {
        await fetch(`/api/agent/sessions/${id}`, { method: 'DELETE' });
      } catch {
        /* archived or not, it's gone from this list until the next refresh */
      }
    },
    [sessionId],
  );

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
            ...(sessionId
              ? { session_id: sessionId }
              : startingNewSession.current
                ? { new_session: true }
                : {}),
            ...(sending.length > 0
              ? { inbound_file_ids: sending.map((a) => a.id) }
              : {}),
          }),
        });
        const data = await res.json();

        // A first message in a fresh panel creates the row server-side; adopt
        // the id so the rest of the conversation lands in the same place, and
        // pull the list again to pick up its auto-derived title.
        if (typeof data?.session_id === 'string' && data.session_id) {
          // Cleared on the response rather than on send: if the request fails
          // there is no row yet, and retrying still means "new chat".
          startingNewSession.current = false;
          if (data.session_id !== sessionId) {
            setSessionId(data.session_id);
          }
          void refreshSessions();
        }

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
              proposals:
                Array.isArray(data.proposed_tasks) &&
                data.proposed_tasks.length > 0
                  ? data.proposed_tasks
                  : undefined,
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
    [user, isLoading, runCommand, attachments, sessionId, refreshSessions],
  );

  const refreshProposals = useCallback(async (proposalIds: string[]) => {
    const ids = proposalIds.filter(Boolean);
    if (ids.length === 0) return;
    try {
      const res = await fetch(
        `/api/proposed-tasks?ids=${encodeURIComponent(ids.join(','))}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const fresh: AgentProposedTaskCard[] = Array.isArray(data?.proposed_tasks)
        ? data.proposed_tasks
        : [];
      const byId = new Map(fresh.map((c) => [c.id, c]));
      const requested = new Set(ids);
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.proposals?.some((p) => requested.has(p.id))) return m;
          const next = m.proposals
            .map((p) => byId.get(p.id) ?? p)
            // A dismissed (or vanished) proposal renders nothing — drop it.
            .filter((p) => byId.has(p.id) ? p.status !== 'dismissed' : true);
          return { ...m, proposals: next.length > 0 ? next : undefined };
        }),
      );
    } catch {
      /* leave the stale card; the next hydration corrects it */
    }
  }, []);

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
            // Land the outcome in the conversation the buttons belong to, not
            // whichever one happens to be open by the time they're clicked.
            ...(sessionId ? { session_id: sessionId } : {}),
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
    [user, sessionId],
  );

  return {
    messages,
    isLoading,
    sessions,
    sessionId,
    isHydrating,
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
  };
}
