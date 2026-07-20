'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';
import type { TiptapJSON } from '@/lib/types';
import type { ProposedTaskData } from './ProposedTask';

// Opens the shared create-task form, pre-filled from a concierge task
// proposal and fully editable. Nothing persists until the user
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
  const seed = useMemo(
    () => ({
      title: proposal.title,
      description: proposal.description ? textToTiptap(proposal.description) : null,
      priority: proposal.priority,
      department_id: proposal.department_id,
      scheduled_date: proposal.scheduled_date ?? null,
      scheduled_time: proposal.scheduled_time ?? null,
      assigned_staff: proposal.suggested_assignee_ids ?? [],
      property_id: propertyId,
      property_name: propertyName,
    }),
    [proposal, propertyId, propertyName]
  );

  // Escape closes the editor (unless mid-create).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Same form and body as everywhere else, but accepting a proposal creates
  // the task AND resolves the proposal in one call, so it posts elsewhere.
  const submitOverride = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await apiFetch(`/api/proposed-tasks/${proposal.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Couldn't create the task");
      }
      onCreated(typeof data?.task_url === 'string' ? data.task_url : null);
      onClose();
      return null; // the endpoint returns a url, not a task row
    },
    [proposal.id, onCreated, onClose]
  );

  // CreateTaskPanel renders its own overlay on both breakpoints.
  return (
    <CreateTaskPanel
      seed={seed}
      onClose={onClose}
      submitOverride={submitOverride}
      submitLabel="Create task"
    />
  );
}
