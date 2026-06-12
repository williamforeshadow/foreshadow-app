'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  ClipboardList,
  Check,
  X,
  Loader2,
  AlertCircle,
  ArrowUpRight,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';

export interface ProposedTaskData {
  id: string;
  title: string;
  description: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  /** The inbound message that triggered the draft; the bubble anchors here. */
  triggering_message_id: string | null;
  department_name: string | null;
}

const PRIORITY_STYLES: Record<ProposedTaskData['priority'], string> = {
  urgent: 'bg-red-500/15 text-red-700 dark:text-red-300',
  high: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  medium: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  low: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};

/**
 * A concierge-proposed task, rendered beneath the guest message that triggered
 * it — the operational sibling of ProposedReply. The draft is persisted (a
 * pending proposed_tasks row); this only displays it. "Create" accepts it (the
 * click IS the confirmation → POST creates the real task via createTaskService,
 * attributed to the clicking user via apiFetch's x-actor-user-id header).
 * "Dismiss" discards it. After either, onChanged() refetches so the bubble
 * clears. Renders nothing when there's no pending proposal.
 */
export function ProposedTask({
  proposal,
  onChanged,
}: {
  proposal: ProposedTaskData;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ task_url: string } | null>(null);

  const accept = useCallback(async () => {
    setBusy('accept');
    setError(null);
    try {
      const res = await apiFetch(`/api/proposed-tasks/${proposal.id}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not create the task.');
        return;
      }
      setCreated({ task_url: typeof data?.task_url === 'string' ? data.task_url : '' });
      onChanged?.();
    } catch {
      setError('Could not create the task.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, onChanged]);

  const dismiss = useCallback(async () => {
    setBusy('dismiss');
    setError(null);
    try {
      const res = await apiFetch(`/api/proposed-tasks/${proposal.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Could not dismiss.');
        return;
      }
      onChanged?.();
    } catch {
      setError('Could not dismiss.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, onChanged]);

  return (
    <div className="mt-4 flex justify-start">
      <div className="msg-in w-full max-w-[88%] overflow-hidden rounded-2xl border border-[var(--accent-3)]/30 bg-[var(--accent-3)]/[0.06] dark:border-[var(--accent-1)]/25 dark:bg-[var(--accent-1)]/[0.08]">
        <div className="flex items-center gap-1.5 px-3.5 pt-2.5 text-[11px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)]">
          <ClipboardList className="h-3 w-3" aria-hidden />
          <span>Proposed task</span>
          <span className="font-normal opacity-70">· review</span>
          <span
            className={`ml-auto rounded-full px-1.5 text-[10px] font-medium capitalize ${PRIORITY_STYLES[proposal.priority]}`}
          >
            {proposal.priority}
          </span>
        </div>

        <div className="px-3.5 py-2.5">
          <p className="text-sm font-medium leading-snug text-foreground">{proposal.title}</p>
          {proposal.department_name ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {proposal.department_name}
            </p>
          ) : null}
          {proposal.description ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {proposal.description}
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-start gap-2 px-3.5 pb-2 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {created ? (
          <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 text-xs text-[var(--accent-3)] dark:text-[var(--accent-1)]">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Task created
            </span>
            {created.task_url ? (
              <Link
                href={created.task_url}
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                Open task
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
            <button
              type="button"
              onClick={dismiss}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--accent-3)]/10 hover:text-foreground disabled:opacity-40 dark:hover:bg-[var(--accent-1)]/15"
            >
              {busy === 'dismiss' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden />
              )}
              Dismiss
            </button>
            <button
              type="button"
              onClick={accept}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-3)] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === 'accept' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              Create task
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
