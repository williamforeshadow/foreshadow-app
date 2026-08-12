'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, RotateCcw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiFetch';
import { channelLabel } from '@/lib/bookingChannel';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';
import { LoadingState } from '@/components/ui/loading-state';
import {
  ProposedKnowledge,
  type ProposedKnowledgeData,
} from '@/components/messages/ProposedKnowledge';

// Knowledge Proposals tab — the property's running action queue of PENDING
// concierge knowledge proposals. Same cyan bubbles as the guest threads, but
// gathered here so operators can clear a backlog in one place instead of
// hunting across conversations. Accept/dismiss go through the shared bubble
// (→ /api/proposed-knowledge/[id]); on change we drop the decided proposal
// from the cached list, so it just disappears from the queue.
//
// Below the queue sits a collapsed list of DISMISSED proposals. It's here because
// a dismissal is now permanent — the concierge is told never to propose that
// content again — so the operator needs to see what's blocked, and needs a way to
// undo a mis-click (Restore → PATCH, back to pending).

interface LedgerProposal extends ProposedKnowledgeData {
  conversation_id: string | null;
  guest_name: string | null;
  channel: string | null;
  generated_at: string | null;
}

interface DismissedProposal {
  id: string;
  summary: string;
  decided_by_name: string | null;
  decided_at: string | null;
  conversation_id: string | null;
  guest_name: string | null;
  channel: string | null;
}

interface ProposalsPayload {
  proposals: LedgerProposal[];
  dismissed: DismissedProposal[];
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const EMPTY_PAYLOAD: ProposalsPayload = { proposals: [], dismissed: [] };

export default function PropertyKnowledgeProposalsTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.propertyKnowledge(propertyId, 'proposals'),
    queryFn: async () => {
      const data = await fetchJson<Partial<ProposalsPayload>>(
        `/api/properties/${propertyId}/knowledge-proposals`,
      );
      return {
        proposals: data.proposals ?? [],
        dismissed: data.dismissed ?? [],
      } as ProposalsPayload;
    },
  });
  const { proposals, dismissed } = query.data ?? EMPTY_PAYLOAD;
  const loading = query.isLoading;
  const error = query.error?.message ?? null;
  const [showDismissed, setShowDismissed] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const patchPayload = useCallback(
    (fn: (prev: ProposalsPayload) => ProposalsPayload) => {
      const key = qk.propertyKnowledge(propertyId, 'proposals');
      queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ProposalsPayload>(key, (old) => fn(old ?? EMPTY_PAYLOAD));
    },
    [queryClient, propertyId],
  );

  // Accept/dismiss are persisted by the shared bubble itself
  // (POST/DELETE /api/proposed-knowledge/[id]). A decided proposal leaves the
  // pending queue; a dismissed one is refetched into the Dismissed list rather
  // than being moved client-side, since only the server knows the decider.
  const removeProposal = useCallback(
    (id: string) => {
      patchPayload((prev) => ({
        ...prev,
        proposals: prev.proposals.filter((p) => p.id !== id),
      }));
      queryClient.invalidateQueries({ queryKey: qk.propertyKnowledge(propertyId, 'proposals') });
    },
    [patchPayload, queryClient, propertyId],
  );

  const restore = useCallback(
    async (id: string) => {
      setRestoring(id);
      setRestoreError(null);
      try {
        const res = await apiFetch(`/api/proposed-knowledge/${id}`, { method: 'PATCH' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data?.error === 'string' ? data.error : 'Could not restore.');
        }
        // Drop it from Dismissed and refetch so it reappears as a pending bubble.
        patchPayload((prev) => ({
          ...prev,
          dismissed: prev.dismissed.filter((d) => d.id !== id),
        }));
        await queryClient.invalidateQueries({
          queryKey: qk.propertyKnowledge(propertyId, 'proposals'),
        });
      } catch (err) {
        setRestoreError(err instanceof Error ? err.message : 'Could not restore.');
      } finally {
        setRestoring(null);
      }
    },
    [patchPayload, queryClient, propertyId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
        <div className="mb-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-600 dark:text-[#a09e9a]">
            Knowledge Proposals
          </h2>
          <p className="text-[12px] leading-snug text-neutral-500 dark:text-[#66645f]">
            Durable facts the concierge drafted from this property’s guest conversations, waiting
            for review. Approve to add them to Property Knowledge, or dismiss. Decided proposals
            stay recorded in their original threads.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {proposals.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[13px] text-neutral-500 dark:text-[#a09e9a]">
              No pending knowledge proposals.
            </p>
            <p className="mx-auto mt-1 max-w-[380px] text-[12px] text-neutral-400 dark:text-[#66645f]">
              When the concierge spots a durable, reusable fact in a guest conversation, it’ll show
              up here for review.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {proposals.map((p) => (
              <div key={p.id} className="w-full max-w-[20rem]">
                {/* Provenance — which conversation/guest produced this proposal. */}
                <div className="flex items-center gap-2 px-0.5 text-[11px] text-neutral-500 dark:text-[#66645f]">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-neutral-600 dark:text-[#a09e9a]">
                      {p.guest_name || 'Guest'}
                    </span>
                    {p.channel ? ` · ${channelLabel(p.channel) || p.channel}` : ''}
                    {p.generated_at ? ` · ${formatWhen(p.generated_at)}` : ''}
                  </span>
                  {p.conversation_id && (
                    <Link
                      href={`/messages/${p.conversation_id}`}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-cyan-600 hover:underline dark:text-cyan-400"
                    >
                      View thread
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </Link>
                  )}
                </div>
                <ProposedKnowledge
                  proposal={p}
                  propertyId={propertyId}
                  align="start"
                  onChanged={() => removeProposal(p.id)}
                />
              </div>
            ))}
          </div>
        )}

        {dismissed.length > 0 && (
          <section className="mt-10 border-t border-neutral-200/80 pt-5 dark:border-[rgba(255,255,255,0.07)]">
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              aria-expanded={showDismissed}
              className="flex items-center gap-1.5 py-1 text-left"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 text-neutral-400 transition-transform dark:text-[#66645f] ${
                  showDismissed ? '' : '-rotate-90'
                }`}
                aria-hidden
              />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-600 dark:text-[#a09e9a]">
                Dismissed ({dismissed.length})
              </span>
            </button>

            {showDismissed && (
              <>
                <p className="mb-3 mt-1 max-w-[520px] text-[12px] leading-snug text-neutral-500 dark:text-[#66645f]">
                  The concierge won’t propose these again. It can still propose a genuinely
                  different value for the same subject — a changed code, time, or instruction.
                  Restore one to put it back in the queue.
                </p>
                {restoreError && (
                  <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                    {restoreError}
                  </div>
                )}
                <div className="flex flex-col divide-y divide-neutral-100 dark:divide-[rgba(255,255,255,0.05)]">
                  {dismissed.map((d) => (
                    <div key={d.id} className="flex items-start gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] leading-snug text-neutral-700 dark:text-[#cbc9c4]">
                          {d.summary || 'Knowledge proposal'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-[#66645f]">
                          {d.decided_by_name ? `Dismissed by ${d.decided_by_name}` : 'Dismissed'}
                          {d.decided_at ? ` · ${formatWhen(d.decided_at)}` : ''}
                          {d.guest_name ? ` · from ${d.guest_name}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restore(d.id)}
                        disabled={restoring === d.id}
                        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-[rgba(30,25,20,0.04)] hover:text-cyan-600 disabled:opacity-50 dark:text-[#a09e9a] dark:hover:bg-[rgba(255,255,255,0.04)] dark:hover:text-cyan-400"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden />
                        {restoring === d.id ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
