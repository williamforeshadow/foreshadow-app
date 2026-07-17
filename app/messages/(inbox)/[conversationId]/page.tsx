'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';
import { CheckCircle2, RotateCcw, Mail, PanelTopOpen } from 'lucide-react';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMessages } from '@/components/messages/MessagesProvider';
import { ConversationThread } from '@/components/messages/ConversationThread';
import { ConversationDetailPanel } from '@/components/messages/ConversationDetailPanel';
import { ConversationOverflowMenu } from '@/components/messages/ConversationOverflowMenu';
import { MobileConversationDetailSheet } from '@/components/messages/MobileConversationDetailSheet';
import { ProposedTaskEditorOverlay } from '@/components/messages/ProposedTaskEditorOverlay';
import { PropertyTaskDetailOverlay } from '@/components/properties/tasks/PropertyTaskDetailOverlay';
import type { ProposedTaskData } from '@/components/messages/ProposedTask';
import type { ProposedKnowledgeData } from '@/components/messages/ProposedKnowledge';
import type { ReservationContextTask } from '@/components/messages/useReservationContext';
import type { ConversationRow } from '@/lib/conversations';
import type { GuestMessageRecord } from '@/lib/messages';
import { taskPath } from '@/src/lib/links';

type ThreadData = {
  conversation?: ConversationRow;
  messages: GuestMessageRecord[];
  proposedTasks: ProposedTaskData[];
  proposedKnowledge: ProposedKnowledgeData[];
  replyProposalEnabled: boolean;
};

const EMPTY_MESSAGES: GuestMessageRecord[] = [];
const EMPTY_PROPOSED_TASKS: ProposedTaskData[] = [];
const EMPTY_PROPOSED_KNOWLEDGE: ProposedKnowledgeData[] = [];

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

  const queryClient = useQueryClient();
  // The proposal whose task editor is open (in-layout right-side panel). Stays
  // open until the user closes it or opens another — not a click-away modal.
  const [editorProposal, setEditorProposal] = useState<ProposedTaskData | null>(null);
  // An already-created associated task opened in the standard task detail panel
  // (the same panel used everywhere else in the app). Bumping tasksRefreshKey
  // after an edit re-fetches the detail panel's associated-tasks list.
  const [selectedTask, setSelectedTask] = useState<ReservationContextTask | null>(null);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  // Mobile-only: the reservation-context top sheet, and a signal the top-bar
  // ••• menu bumps to start "turn into training" selection inside the thread.
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectionSignal, setSelectionSignal] = useState(0);

  // Cached thread — revisiting a conversation paints instantly from cache
  // and refreshes in the background.
  const threadQuery = useQuery({
    queryKey: qk.conversation(conversationId),
    enabled: !!conversationId,
    queryFn: async (): Promise<ThreadData> => {
      const data = await fetchJson<{
        conversation?: ConversationRow;
        messages?: GuestMessageRecord[];
        proposed_tasks?: ProposedTaskData[];
        proposed_knowledge?: ProposedKnowledgeData[];
        reply_proposal_enabled?: boolean;
      }>(`/api/messages/${conversationId}`);
      return {
        conversation: data.conversation ?? undefined,
        messages: data.messages ?? [],
        proposedTasks: data.proposed_tasks ?? [],
        proposedKnowledge: data.proposed_knowledge ?? [],
        // The org's autonomous reply-drafting master switch. Defaults to true
        // so a stale/failed read never hides the proposal.
        replyProposalEnabled: data.reply_proposal_enabled !== false,
      };
    },
  });
  const conversation = threadQuery.data?.conversation;
  const messages = threadQuery.data?.messages ?? EMPTY_MESSAGES;
  const proposedTasks = threadQuery.data?.proposedTasks ?? EMPTY_PROPOSED_TASKS;
  const proposedKnowledge = threadQuery.data?.proposedKnowledge ?? EMPTY_PROPOSED_KNOWLEDGE;
  const replyProposalEnabled = threadQuery.data?.replyProposalEnabled ?? true;
  const loading = threadQuery.isLoading;
  const error = threadQuery.isError;

  // Kept under its old name — threaded through ~8 child callbacks as the
  // "refetch the thread" trigger.
  const { refetch: refetchThread } = threadQuery;
  const load = useCallback(async () => {
    await refetchThread();
  }, [refetchThread]);

  // Mark read on open (optimistic cache patch so the effect doesn't re-fire
  // after background refetches unless the server still says unread).
  useEffect(() => {
    if (conversation?.id && conversation.unread) {
      fetch(`/api/messages/${conversation.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unread: false }),
      }).then(() => reload());
      queryClient.cancelQueries({ queryKey: qk.conversation(conversationId) });
      queryClient.setQueryData<ThreadData>(qk.conversation(conversationId), (old) =>
        old?.conversation
          ? { ...old, conversation: { ...old.conversation, unread: false } }
          : old
      );
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

  // "Turn into training" is available once the thread has messages (mirrors the
  // thread's own guard); gates the ••• menu item.
  const canSelect = !!conversationId && messages.length > 0;

  if (isMobile) {
    // Opening a task / proposal from the top sheet: close the sheet first so its
    // full-screen overlay doesn't stack behind the sheet.
    const openTaskFromSheet = (task: ReservationContextTask) => {
      setDetailOpen(false);
      openTaskDetail(task);
    };
    const openProposalFromSheet = (proposal: ProposedTaskData) => {
      setDetailOpen(false);
      openProposalEditor(proposal);
    };

    const topBarActions = conversation ? (
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          aria-label="Reservation details"
          title="Details"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-[rgba(30,25,20,0.04)] dark:text-[#a09e9a] dark:hover:bg-[rgba(255,255,255,0.04)]"
        >
          <PanelTopOpen className="h-[21px] w-[21px]" strokeWidth={1.75} />
        </button>
        <ConversationOverflowMenu
          isComplete={conversation.app_status === 'complete'}
          onToggleComplete={() =>
            patchStatus({
              app_status:
                conversation.app_status === 'complete' ? 'active' : 'complete',
            })
          }
          onMarkUnread={() => patchStatus({ unread: true })}
          canTrain={canSelect}
          onTurnIntoTraining={() => setSelectionSignal((n) => n + 1)}
        />
      </div>
    ) : null;

    return (
      <MobileRouteShell
        backHref="/messages"
        title={conversation?.guest_name ?? 'Conversation'}
        rightSlot={topBarActions}
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
            hideInlineSelectionEntry
            startSelectionSignal={selectionSignal}
            proposedReply={conversation?.proposed_reply ?? null}
            proposedReplySource={conversation?.proposed_reply_source ?? null}
            proposedReplyAnswersMessageId={conversation?.proposed_reply_answers_message_id ?? null}
            proposedReplyDeclinedMessageId={
              conversation?.proposed_reply_declined_message_id ?? null
            }
            replyProposalEnabled={replyProposalEnabled}
            onProposedReplyChange={load}
            proposedTasks={proposedTasks}
            onProposedTaskChange={handleProposedTaskChange}
            onOpenTaskEditor={openProposalEditor}
            proposedKnowledge={proposedKnowledge}
            onProposedKnowledgeChange={load}
          />
        </div>

        <MobileConversationDetailSheet
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          conversation={conversation}
          proposedTasks={proposedTasks}
          tasksRefreshKey={tasksRefreshKey}
          onOpenTask={openTaskFromSheet}
          onOpenProposal={openProposalFromSheet}
          onProposedTaskChange={handleProposedTaskChange}
        />

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

        {selectedTask ? (
          <PropertyTaskDetailOverlay
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onTaskUpdated={() => setTasksRefreshKey((k) => k + 1)}
            onOpenInPage={() => router.push(taskPath(selectedTask.task_id))}
          />
        ) : null}
      </MobileRouteShell>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
          proposedReplyDeclinedMessageId={conversation?.proposed_reply_declined_message_id ?? null}
          replyProposalEnabled={replyProposalEnabled}
          onProposedReplyChange={load}
          proposedTasks={proposedTasks}
          onProposedTaskChange={handleProposedTaskChange}
          onOpenTaskEditor={openProposalEditor}
          proposedKnowledge={proposedKnowledge}
          onProposedKnowledgeChange={load}
        />
      </div>
      <aside className="msg-divider hidden w-80 shrink-0 overflow-hidden border-l lg:block">
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
