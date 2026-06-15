'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  X,
  Loader2,
  AlertCircle,
  ArrowUpRight,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import { ProjectCard, type DraggableProjectItem } from '@/components/windows/projects/ProjectCard';
import type { ProjectStatus, ProjectPriority } from '@/lib/types';

export interface ProposedTaskData {
  id: string;
  title: string;
  description: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  /** The inbound message that triggered the draft; the bubble anchors here. */
  triggering_message_id: string | null;
  department_id: string | null;
  department_name: string | null;
  /** 'pending' (editable card) or 'accepted' (approved tombstone). */
  status?: 'pending' | 'accepted';
  /** Who approved it + when, for the accepted tombstone. */
  decided_by_name?: string | null;
  decided_at?: string | null;
  resulting_task_id?: string | null;
  task_url?: string | null;
}

// Adapt a proposed-task draft into the shape the kanban/chat ProjectCard renders,
// so a proposal previews exactly like a real task (title, dept icon, priority,
// status). A draft has no assignee or schedule yet and hasn't started, so those
// fields are empty / not_started — the card renders them honestly (no avatars).
function proposedTaskToCardItem(
  p: ProposedTaskData,
  propertyName: string | null,
): DraggableProjectItem {
  return {
    id: p.id,
    columnId: 'proposed',
    project: {
      id: p.id,
      title: p.title,
      property_name: propertyName,
      status: 'not_started' as ProjectStatus,
      priority: p.priority as ProjectPriority,
      department_id: p.department_id,
      department_name: p.department_name,
      project_assignments: [],
      created_at: '',
      updated_at: '',
    },
  };
}

function formatDecidedAt(iso: string | null | undefined): string {
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

/**
 * A concierge-proposed task, rendered beneath the guest message that triggered
 * it — the operational sibling of ProposedReply. The draft is persisted (a
 * pending proposed_tasks row); this only displays it. To stay visually
 * consistent with the rest of the app, the proposal previews as the SAME task
 * card used on the bins kanban and in the AI chat (ProjectCard); the fuller
 * description sits beneath it, with the accept/dismiss actions.
 *
 * Clicking the card opens the SAME task editor used elsewhere (pre-filled and
 * editable) — creating from there commits the (possibly edited) task. The inline
 * "Create task" button is a one-click quick-create from the proposal as-is.
 * Either path flips the proposal to accepted; it then renders as an in-thread
 * "approved by … " tombstone instead of vanishing. "Dismiss" discards it.
 */
export function ProposedTask({
  proposal,
  propertyName = null,
  align = 'end',
  onOpenEditor,
  onChanged,
  onAccept,
  onDismiss,
}: {
  proposal: ProposedTaskData;
  propertyName?: string | null;
  /** Which side the bubble sits on. 'end' (right) in the inbox; 'start' (left)
   *  in the concierge test console, where the AI sits on the left. */
  align?: 'start' | 'end';
  /** Open the full task editor (rendered at the page level, in-layout). */
  onOpenEditor?: () => void;
  onChanged?: () => void;
  /** Test-mode override: replaces the persisted accept (no DB write). */
  onAccept?: () => void | Promise<void>;
  /** Test-mode override: replaces the persisted dismiss (no DB write). */
  onDismiss?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const justify = align === 'start' ? 'justify-start' : 'justify-end';

  // Quick-create: accept the proposal as-is (no edits). The body is omitted so
  // the endpoint creates straight from the stored proposal.
  const accept = useCallback(async () => {
    setBusy('accept');
    setError(null);
    try {
      if (onAccept) {
        await onAccept();
        return;
      }
      const res = await apiFetch(`/api/proposed-tasks/${proposal.id}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not create the task.');
        return;
      }
      onChanged?.();
    } catch {
      setError('Could not create the task.');
    } finally {
      setBusy(null);
    }
  }, [proposal.id, onChanged, onAccept]);

  const dismiss = useCallback(async () => {
    setBusy('dismiss');
    setError(null);
    try {
      if (onDismiss) {
        await onDismiss();
        return;
      }
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
  }, [proposal.id, onChanged, onDismiss]);

  // Accepted → compact "approved by … " tombstone, kept in the thread.
  if (proposal.status === 'accepted') {
    const when = formatDecidedAt(proposal.decided_at);
    const who = proposal.decided_by_name || 'someone';
    return (
      <div className={`mt-4 flex ${justify}`}>
        <div className="msg-in flex w-full max-w-[20rem] items-center gap-2 rounded-2xl border border-[var(--accent-3)]/20 px-3 py-2 text-[12px] text-muted-foreground dark:border-[var(--accent-1)]/20">
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
          <span className="min-w-0 flex-1">
            Task proposal approved by{' '}
            <span className="font-medium text-foreground">{who}</span>
            {when ? ` · ${when}` : ''}
          </span>
          {proposal.task_url ? (
            <Link
              href={proposal.task_url}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-[var(--accent-3)] hover:underline dark:text-[var(--accent-1)]"
            >
              Open
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`mt-4 flex ${justify}`}>
      <div className="msg-in flex w-full max-w-[20rem] flex-col gap-2 rounded-2xl border border-[var(--accent-3)]/30 p-2.5 dark:border-[var(--accent-1)]/25">
        {/* Provenance label — marks this as a concierge draft, not a live task.
            Uses the same Tasks icon as the app sidebar for consistency. */}
        <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span>Proposed Task</span>
        </div>

        {/* The proposal previews as the same task card used everywhere else.
            Clicking it opens the full editor, pre-filled and editable. */}
        <button
          type="button"
          onClick={() => onOpenEditor?.()}
          className="block w-full rounded-[0.5625rem] text-left transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] dark:focus-visible:ring-[var(--accent-ring-dark)]"
          title="Open to review and edit before creating"
        >
          <ProjectCard
            item={proposedTaskToCardItem(proposal, propertyName)}
            viewMode="status"
          />
        </button>

        {/* Full description sits under the card — it won't fit on the card itself. */}
        {proposal.description ? (
          <p className="whitespace-pre-wrap break-words px-0.5 text-[13px] leading-relaxed text-muted-foreground">
            {proposal.description}
          </p>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 px-0.5 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
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
      </div>
    </div>
  );
}
