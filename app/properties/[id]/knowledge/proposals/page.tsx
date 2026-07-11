'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import { channelLabel } from '@/lib/bookingChannel';
import {
  ProposedKnowledge,
  type ProposedKnowledgeData,
} from '@/components/messages/ProposedKnowledge';

// Knowledge Proposals tab — the property's running action queue of PENDING
// concierge knowledge proposals. Same cyan bubbles as the guest threads, but
// gathered here so operators can clear a backlog in one place instead of
// hunting across conversations. Accept/dismiss go through the shared bubble
// (→ /api/proposed-knowledge/[id]); on change we silently refetch, so a decided
// item just drops out of the queue.

interface LedgerProposal extends ProposedKnowledgeData {
  conversation_id: string | null;
  guest_name: string | null;
  channel: string | null;
  generated_at: string | null;
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

export default function PropertyKnowledgeProposalsTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [proposals, setProposals] = useState<LedgerProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProposals = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/knowledge-proposals`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load proposals');
        setProposals((data.proposals ?? []) as LedgerProposal[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load proposals');
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [propertyId],
  );

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
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
                  onChanged={() => fetchProposals({ silent: true })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
