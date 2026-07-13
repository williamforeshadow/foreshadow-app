'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, RotateCcw, Mail } from 'lucide-react';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMessages } from '@/components/messages/MessagesProvider';
import { ConversationThread } from '@/components/messages/ConversationThread';
import { ConversationDetailPanel } from '@/components/messages/ConversationDetailPanel';
import { ProposedTaskEditorOverlay } from '@/components/messages/ProposedTaskEditorOverlay';
import { PropertyTaskDetailOverlay } from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import type { ProposedTaskData } from '@/components/messages/ProposedTask';
import type { ProposedKnowledgeData } from '@/components/messages/ProposedKnowledge';
import type { ReservationContextTask } from '@/components/messages/useReservationContext';
import type { ConversationRow } from '@/lib/conversations';
import type { GuestMessageRecord } from '@/lib/messages';
import { taskPath } from '@/src/lib/links';

// /messages/[conversationId] — one conversation (uuid). Fetches the thread, marks
// it read on open, and exposes complete/reopen + mark-unread actions.
export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { reload } = useMessages();

  const raw = params?.conversationId;
  const idParam = Array.isArray(raw) ? raw[0] : raw;
  const conversationId = idParam ? decodeURIComponent(idParam) : '';

  const [conversation, setConversation] = useState<ConversationRow | undefined>();
  const [messages, setMessages] = useState<GuestMessageRecord[]>([]);
  const [proposedTasks, setProposedTasks] = useState<ProposedTaskData[]>([]);
  const [proposedKnowledge, setProposedKnowledge] = useState<ProposedKnowledgeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // The proposal whose task editor is open (in-layout right-side panel). Stays
  // open until the user closes it or opens another — not a click-away modal.
  const [editorProposal, setEditorProposal] = useState<ProposedTaskData | null>(null);
  // An already-created associated task opened in the standard task detail panel
  // (the same panel used everywhere else in the app). Bumping tasksRefreshKey
  // after an edit re-fetches the detail panel's associated-tasks list.
  const [selectedTask, setSelectedTask] = useState<ReservationContextTask | null>(null);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/messages/${conversationId}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      setConversation(data.conversation ?? undefined);
      setMessages(data.messages ?? []);
      setProposedTasks((data.proposed_tasks as ProposedTaskData[] | undefined) ?? []);
      setProposedKnowledge((data.proposed_knowledge as ProposedKnowledgeData[] | undefined) ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Mark read on open.
  useEffect(() => {
    if (conversation?.id && conversation.unread) {
      fetch(`/api/messages/${conversation.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unread: false }),
      }).then(() => reload());
      setConversation((c) => (c ? { ...c, unread: false } : c));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  const patchStatus = useCallback(
    async (patch: Record<string, unknown>) => {
      await fetch(`/api/messages/${conversationId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await load();
      reload();
    },
    [conversationId, load, reload],
  );

  // The proposed-task editor and the created-task detail panel share the same
  // right-side slot — keep them mutually exclusive (open one, close the other).
  const openProposalEditor = useCallback((proposal: ProposedTaskData) => {
    setSelectedTask(null);
    setEditorProposal(proposal);
  }, []);
  const openTaskDetail = useCallback((task: ReservationContextTask) => {
    setEditorProposal(null);
    setSelectedTask(task);
  }, []);
  // A proposal was accepted/dismissed: refetch the thread (proposals + tombstones)
  // and bump the associated-tasks list so a newly created task shows up there.
  const handleProposedTaskChange = useCallback(() => {
    load();
    setTasksRefreshKey((k) => k + 1);
  }, [load]);

  if (isMobile === null) return null;

  const actions = conversation ? (
    <>
      {conversation.app_status === 'complete' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Reopen"
          aria-label="Reopen"
          onClick={() => patchStatus({ app_status: 'active' })}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Mark complete"
          aria-label="Mark complete"
          onClick={() => patchStatus({ app_status: 'complete' })}
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Mark unread"
        aria-label="Mark unread"
        onClick={() => patchStatus({ unread: true })}
      >
        <Mail className="h-4 w-4" />
      </Button>
    </>
  ) : null;

  if (isMobile) {
    return (
      <MobileRouteShell
        backHref="/messages"
        title={conversation?.guest_name ?? 'Conversation'}
      >
        <div className="flex h-full flex-col">
          <ConversationThread
            messages={messages}
            conversationId={conversationId}
            guestName={conversation?.guest_name}
            propertyName={conversation?.property_name}
            propertyId={conversation?.property_id}
            channel={conversation?.channel}
            loading={loading}
            error={error}
            onRetry={load}
            showHeader={false}
            actions={actions}
            proposedReply={conversation?.proposed_reply ?? null}
            proposedReplySource={conversation?.proposed_reply_source ?? null}
            proposedReplyAnswersMessageId={conversation?.proposed_reply_answers_message_id ?? null}
            onProposedReplyChange={load}
            proposedTasks={proposedTasks}
            onProposedTaskChange={handleProposedTaskChange}
            onOpenTaskEditor={openProposalEditor}
            proposedKnowledge={proposedKnowledge}
            onProposedKnowledgeChange={load}
          />
        </div>
        {editorProposal ? (
          <ProposedTaskEditorOverlay
            proposal={editorProposal}
            propertyId={conversation?.property_id ?? null}
            propertyName={conversation?.property_name ?? null}
            onClose={() => setEditorProposal(null)}
            onCreated={() => {
              setEditorProposal(null);
              load();
              reload();
            }}
          />
        ) : null}
      </MobileRouteShell>
    );
  }

  return (
    <div className="flex h-full gap-2.5">
      <div className="msg-pane flex min-w-0 flex-1 flex-col overflow-hidden">
        <ConversationThread
          messages={messages}
          conversationId={conversationId}
          guestName={conversation?.guest_name}
          propertyName={conversation?.property_name}
          propertyId={conversation?.property_id}
          channel={conversation?.channel}
          loading={loading}
          error={error}
          onRetry={load}
          actions={actions}
          proposedReply={conversation?.proposed_reply ?? null}
          proposedReplySource={conversation?.proposed_reply_source ?? null}
          proposedReplyAnswersMessageId={conversation?.proposed_reply_answers_message_id ?? null}
          onProposedReplyChange={load}
          proposedTasks={proposedTasks}
          onProposedTaskChange={handleProposedTaskChange}
          onOpenTaskEditor={openProposalEditor}
          proposedKnowledge={proposedKnowledge}
          onProposedKnowledgeChange={load}
        />
      </div>
      <aside className="msg-pane hidden w-80 shrink-0 overflow-hidden lg:block">
        <ConversationDetailPanel
          conversation={conversation}
          onOpenTask={openTaskDetail}
          tasksRefreshKey={tasksRefreshKey}
          proposedTasks={proposedTasks}
          onOpenProposal={openProposalEditor}
          onProposedTaskChange={handleProposedTaskChange}
        />
      </aside>
      {editorProposal ? (
        <ProposedTaskEditorOverlay
          proposal={editorProposal}
          propertyId={conversation?.property_id ?? null}
          propertyName={conversation?.property_name ?? null}
          onClose={() => setEditorProposal(null)}
          onCreated={() => {
            setEditorProposal(null);
            load();
            reload();
            setTasksRefreshKey((k) => k + 1);
          }}
        />
      ) : null}
      {selectedTask ? (
        <PropertyTaskDetailOverlay
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={() => setTasksRefreshKey((k) => k + 1)}
          onOpenInPage={() => router.push(taskPath(selectedTask.task_id))}
        />
      ) : null}
    </div>
  );
}
