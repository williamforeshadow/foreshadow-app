'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { useIsMobile } from '@/lib/useIsMobile';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import {
  emptyDraft,
  type TaskDraft,
} from '@/components/tasks/detail/taskInput';
import type { TaskCreatePayload } from '@/components/tasks/detail/useTaskDetailController';
import { DESKTOP_TASK_PANEL_SLOT } from '@/lib/detailPanelGeometry';
import type { TiptapJSON } from '@/lib/types';
import type { ProposedTaskData } from './ProposedTask';

// Opens the unified task detail panel in draft mode, pre-filled from a
// concierge task proposal and fully editable. Nothing persists until the user
// hits "Create task", which sends the (possibly edited) fields to the
// proposal-accept endpoint — creating the real task AND flipping the proposal
// to accepted (recording who/when).

// Wrap the proposal's plain-text description into a minimal Tiptap doc so the
// rich-text editor renders it (the editor only understands Tiptap JSON).
function textToTiptap(text: string): TiptapJSON {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  } as unknown as TiptapJSON;
}

export function ProposedTaskEditorOverlay({
  proposal,
  propertyId = null,
  propertyName = null,
  onClose,
  onCreated,
}: {
  proposal: ProposedTaskData;
  propertyId?: string | null;
  propertyName?: string | null;
  onClose: () => void;
  /** Called after a successful create with the new task's url (or null). */
  onCreated: (taskUrl: string | null) => void;
}) {
  const isMobile = useIsMobile();
  const [creating, setCreating] = useState(false);

  const [draft, setDraft] = useState<TaskDraft>(() =>
    emptyDraft({
      title: proposal.title,
      description: proposal.description ? textToTiptap(proposal.description) : null,
      priority: proposal.priority,
      department_id: proposal.department_id,
      scheduled_date: proposal.scheduled_date ?? null,
      scheduled_time: proposal.scheduled_time ?? null,
      assigned_staff: proposal.suggested_assignee_ids ?? [],
      property_id: propertyId,
      property_name: propertyName,
    })
  );

  // Escape closes the editor (unless mid-create).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, creating]);

  const handleConfirmCreate = useCallback(
    async (payload: TaskCreatePayload) => {
      setCreating(true);
      try {
        const res = await apiFetch(`/api/proposed-tasks/${proposal.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: payload.fields.title || proposal.title,
            description: payload.fields.description ?? null,
            priority: payload.fields.priority || proposal.priority,
            status: payload.fields.status || 'not_started',
            department_id: payload.fields.department_id || null,
            property_id: payload.property_id || null,
            template_id: payload.template_id || null,
            scheduled_date: payload.fields.scheduled_date || null,
            scheduled_time: payload.fields.scheduled_time || null,
            assigned_user_ids: payload.fields.assigned_staff || [],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error('[proposed task editor] create failed', data);
          toast.error(data?.error || "Couldn't create the task");
          setCreating(false);
          return;
        }
        onCreated(typeof data?.task_url === 'string' ? data.task_url : null);
        onClose();
      } catch (err) {
        console.error('[proposed task editor] create error', err);
        toast.error("Couldn't create the task");
        setCreating(false);
      }
    },
    [proposal.id, proposal.title, proposal.priority, onCreated, onClose]
  );

  const panel = (
    <TaskDetailPanel
      task={null}
      draft={draft}
      onDraftChange={setDraft}
      onConfirmCreate={handleConfirmCreate}
      creating={creating}
      onClose={onClose}
    />
  );

  if (isMobile) return panel; // self-renders fixed inset-0

  return <div className={DESKTOP_TASK_PANEL_SLOT}>{panel}</div>;
}
