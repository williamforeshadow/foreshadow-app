'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/react';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/authContext';
import { qk } from '@/lib/queries';

// The one create path. Every surface that makes a task goes through this, so
// the resulting row is identical no matter where creation started — previously
// each caller built its own POST body and they had drifted (is_binned was
// derived in one place, hardcoded false in another, omitted in a third, and
// mobile never sent bin_id at all).
//
// Field names mirror `createTaskInputSchema` in src/server/tasks/createTask.ts.

/** Context the opening surface supplies. Property and template are fixed at
 *  creation — they can't be changed afterwards — so they're seeded, not edited
 *  later. Everything else is just a prefill the user can override. */
export interface TaskCreateSeed {
  property_id?: string | null;
  property_name?: string | null;
  template_id?: string | null;
  template_name?: string | null;
  bin_id?: string | null;
  is_binned?: boolean;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  department_id?: string | null;
  status?: string;
  priority?: string;
}

export interface TaskCreateDraft {
  title: string;
  description: JSONContent | null;
  status: string;
  priority: string;
  department_id: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  assigned_staff: string[];
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  bin_id: string | null;
  is_binned: boolean;
}

/** The created row, as returned by POST /api/tasks-for-bin. */
export interface CreatedTaskRow {
  id: string;
  [key: string]: unknown;
}

export interface TaskCreateErrors {
  title?: string;
}

function draftFromSeed(seed: TaskCreateSeed): TaskCreateDraft {
  return {
    // A template's name is the default title, and stays fully editable.
    title: seed.template_name ?? '',
    description: null,
    status: seed.status ?? 'not_started',
    priority: seed.priority ?? 'medium',
    department_id: seed.department_id ?? null,
    scheduled_date: seed.scheduled_date ?? null,
    scheduled_time: seed.scheduled_time ?? null,
    assigned_staff: [],
    property_id: seed.property_id ?? null,
    property_name: seed.property_name ?? null,
    template_id: seed.template_id ?? null,
    template_name: seed.template_name ?? null,
    bin_id: seed.bin_id ?? null,
    is_binned: seed.is_binned ?? !!seed.bin_id,
  };
}

export function useTaskCreate({
  seed,
  onCreated,
}: {
  seed: TaskCreateSeed;
  /** Fired with the created row so the surface can react (open it, close the
   *  sheet, select it). Surfaces should do UI only — persistence is done. */
  onCreated?: (task: CreatedTaskRow) => void;
}) {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const currentUserId = (authUser as { id?: string } | null)?.id ?? null;

  // Seed once per mount; the surface remounts (via key) to start a new task.
  const [draft, setDraft] = useState<TaskCreateDraft>(() => draftFromSeed(seed));
  const [attachments, setAttachments] = useState<File[]>([]);
  const [errors, setErrors] = useState<TaskCreateErrors>({});
  const [creating, setCreating] = useState(false);

  // Once the user edits the title themselves, picking a template must not
  // overwrite what they typed.
  const titleDirtyRef = useRef(false);

  const updateField = useCallback(
    <K extends keyof TaskCreateDraft>(key: K, value: TaskCreateDraft[K]) => {
      if (key === 'title') {
        titleDirtyRef.current = true;
        setErrors((prev) => (prev.title ? { ...prev, title: undefined } : prev));
      }
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  /** Choosing a template fills the title with the template's name unless the
   *  user has already typed one of their own. */
  const setTemplate = useCallback((templateId: string | null, templateName: string | null) => {
    setDraft((prev) => ({
      ...prev,
      template_id: templateId,
      template_name: templateName,
      title: titleDirtyRef.current || !templateName ? prev.title : templateName,
    }));
    if (!titleDirtyRef.current && templateName) {
      setErrors((prev) => (prev.title ? { ...prev, title: undefined } : prev));
    }
  }, []);

  /** Bin selection mirrors the detail panel: a sub-bin implies binned; with no
   *  sub-bin, `isBinned` distinguishes the system Task Bin from no bin at all.
   *  (The server rejects is_binned:false alongside a bin_id.) */
  const setBin = useCallback((binId: string | null, isBinned: boolean) => {
    setDraft((prev) => ({
      ...prev,
      bin_id: binId,
      is_binned: binId ? true : isBinned,
    }));
  }, []);

  const addAttachments = useCallback((files: File[]) => {
    if (files.length) setAttachments((prev) => [...prev, ...files]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const invalidateTaskCaches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks-for-bin'] });
    queryClient.invalidateQueries({ queryKey: qk.allTasks });
    queryClient.invalidateQueries({ queryKey: qk.timeline });
    queryClient.invalidateQueries({ queryKey: qk.turnovers });
    queryClient.invalidateQueries({ queryKey: qk.projectBins });
    if (currentUserId) {
      queryClient.invalidateQueries({ queryKey: qk.myAssignments(currentUserId) });
    }
    if (draft.property_id) {
      queryClient.invalidateQueries({ queryKey: qk.propertyTasks(draft.property_id) });
    }
  }, [queryClient, currentUserId, draft.property_id]);

  /** Attachments can only be uploaded once the task has an id, so staged files
   *  are sent after creation. A failed upload doesn't fail the task. */
  const uploadStagedAttachments = useCallback(
    async (taskId: string) => {
      if (!attachments.length || !currentUserId) return;
      let failed = 0;
      for (const file of attachments) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('task_id', taskId);
          formData.append('uploaded_by', currentUserId);
          const res = await fetch('/api/project-attachments', { method: 'POST', body: formData });
          if (!res.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed) {
        toast.error(
          failed === 1 ? "One attachment didn't upload" : `${failed} attachments didn't upload`
        );
      }
    },
    [attachments, currentUserId]
  );

  const titleValid = draft.title.trim().length > 0;
  const canSubmit = titleValid && !creating;

  const submit = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) {
      // Title is the only required field — surface it inline rather than
      // silently inventing one (every old caller sent `title || 'New Task'`).
      setErrors({ title: 'Task title is required.' });
      return null;
    }

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        title,
        description: draft.description ?? null,
        status: draft.status,
        priority: draft.priority,
        scheduled_date: draft.scheduled_date || null,
        scheduled_time: draft.scheduled_time || null,
        property_id: draft.property_id || null,
        department_id: draft.department_id || null,
        template_id: draft.template_id || null,
        bin_id: draft.bin_id || null,
        is_binned: draft.bin_id ? true : draft.is_binned,
      };
      if (draft.assigned_staff.length) body.assigned_user_ids = draft.assigned_staff;

      const res = await apiFetch('/api/tasks-for-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.data) {
        throw new Error(result?.error || `Failed to create the task (HTTP ${res.status})`);
      }

      const created = result.data as CreatedTaskRow;
      await uploadStagedAttachments(created.id);
      invalidateTaskCaches();
      onCreated?.(created);
      return created;
    } catch (err) {
      console.error('Error creating task:', err);
      toast.error(err instanceof Error ? err.message : "Couldn't create the task");
      return null;
    } finally {
      setCreating(false);
    }
  }, [draft, uploadStagedAttachments, invalidateTaskCaches, onCreated]);

  return useMemo(
    () => ({
      draft,
      updateField,
      setTemplate,
      setBin,
      attachments,
      addAttachments,
      removeAttachment,
      errors,
      creating,
      canSubmit,
      submit,
    }),
    [
      draft,
      updateField,
      setTemplate,
      setBin,
      attachments,
      addAttachments,
      removeAttachment,
      errors,
      creating,
      canSubmit,
      submit,
    ]
  );
}
