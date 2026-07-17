'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/authContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { ProjectDetailPanel } from '@/components/windows/projects';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import type {
  Project,
  ProjectFormFields,
  PropertyOption,
  TaskTemplate,
  TiptapJSON,
  User,
} from '@/lib/types';
import type { ProposedTaskData } from './ProposedTask';

// Opens the SAME task editor used on Bins / Tasks / Schedule (ProjectDetailPanel
// in new-task mode), pre-filled from a concierge task proposal and fully
// editable. It does not persist incremental edits — the draft lives in local
// state until the user hits "Create Task", at which point the (possibly edited)
// fields are sent to the proposal-accept endpoint, which creates the real task
// AND flips the proposal to accepted (recording who/when). Mirrors the new-task
// wiring in PropertyTasksView, minus all the list-side state.

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

const noop = () => {};

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
  const { user: authUser, allUsers } = useAuth();
  const users = allUsers as unknown as User[];
  const currentUser = authUser as unknown as User | null;
  const isMobile = useIsMobile();

  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);

  const descriptionDoc = proposal.description ? textToTiptap(proposal.description) : null;

  // The draft project the panel reads from (property, id, base fields). Editable
  // values are held in `editingFields`; property changes patch this draft.
  const [draft, setDraft] = useState<Project>(() => ({
    id: `proposed-${proposal.id}`,
    property_id: propertyId,
    property_name: propertyName,
    bin_id: null,
    is_binned: false,
    template_id: null,
    template_name: null,
    title: proposal.title,
    description: descriptionDoc,
    status: 'not_started',
    priority: proposal.priority,
    department_id: proposal.department_id,
    department_name: proposal.department_name,
    scheduled_date: proposal.scheduled_date ?? null,
    scheduled_time: proposal.scheduled_time ?? null,
    project_assignments: [],
    created_at: '',
    updated_at: '',
  }));

  const [editingFields, setEditingFields] = useState<ProjectFormFields | null>(() => ({
    title: proposal.title,
    description: descriptionDoc,
    status: 'not_started',
    priority: proposal.priority,
    assigned_staff: proposal.suggested_assignee_ids ?? [],
    department_id: proposal.department_id || '',
    scheduled_date: proposal.scheduled_date ?? '',
    scheduled_time: proposal.scheduled_time ?? '',
  }));
  const editingFieldsRef = useRef<ProjectFormFields | null>(editingFields);
  useEffect(() => {
    editingFieldsRef.current = editingFields;
  }, [editingFields]);

  const [staffOpen, setStaffOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  // Escape closes the editor (unless mid-create).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, creating]);

  // Properties (for the property picker) + templates (template picker is
  // editable in new-task mode). Same lazy fetches as PropertyTaskDetailOverlay.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (!cancelled && res.ok && result.properties) setAllProperties(result.properties);
      } catch {
        /* non-fatal — picker just won't list properties */
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/tasks');
        const result = await res.json();
        if (!cancelled && res.ok && result.data) setAvailableTemplates(result.data);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePropertyChange = useCallback(
    (pid: string | null, name: string | null) => {
      setDraft((prev) => ({ ...prev, property_id: pid, property_name: name }));
    },
    [],
  );

  const handleTemplateChange = useCallback(
    (templateId: string | null) => {
      setDraft((prev) => ({
        ...prev,
        template_id: templateId,
        template_name: templateId
          ? availableTemplates.find((t) => t.id === templateId)?.name ?? null
          : null,
      }));
    },
    [availableTemplates],
  );

  const handleConfirmCreate = useCallback(
    async (directFields?: ProjectFormFields) => {
      const fields = directFields ?? editingFieldsRef.current;
      setCreating(true);
      try {
        const res = await apiFetch(`/api/proposed-tasks/${proposal.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: fields?.title || proposal.title,
            description: fields?.description ?? null,
            priority: fields?.priority || proposal.priority,
            status: fields?.status || 'not_started',
            department_id: fields?.department_id || null,
            property_id: draft.property_id || null,
            template_id: draft.template_id || null,
            scheduled_date: fields?.scheduled_date || null,
            scheduled_time: fields?.scheduled_time || null,
            assigned_user_ids: fields?.assigned_staff || [],
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
    [
      proposal.id,
      proposal.title,
      proposal.priority,
      draft.property_id,
      draft.template_id,
      onCreated,
      onClose,
    ],
  );

  if (!editingFields) return null;

  // Mobile: native full-screen sheet (owns its own chrome).
  if (isMobile) {
    return (
      <MobileProjectDetail
        project={draft}
        users={users}
        onClose={onClose}
        onSave={async () => null}
        onDelete={onClose}
        allProperties={allProperties}
        onPropertyChange={handlePropertyChange}
        availableTemplates={availableTemplates}
        onTemplateChange={handleTemplateChange}
        isNewTask
        onConfirmCreate={(fields) => handleConfirmCreate(fields)}
        creatingTask={creating}
      />
    );
  }

  // Desktop: an in-layout right-side panel using the app's standard detail-panel
  // geometry (DESKTOP_DETAIL_PANEL_FLEX = absolute inset-y-0 right-0 w-1/3),
  // anchored to the conversation page's relative main area — exactly like the
  // task panel on Bins / Tasks / Schedule. It therefore resizes with the content
  // area (e.g. when the sidebar pins out) and persists until the user hits X or
  // opens another task. NOT a modal: no backdrop, no click-away dismissal.
  return (
    <div className={DESKTOP_DETAIL_PANEL_FLEX}>
      <ProjectDetailPanel
          project={draft}
          editingFields={editingFields}
          setEditingFields={setEditingFields}
          users={users}
          allProperties={allProperties}
          savingEdit={false}
          onSave={noop}
          onDelete={onClose}
          onClose={onClose}
          onOpenActivity={noop}
          onPropertyChange={handlePropertyChange}
          staffOpen={staffOpen}
          setStaffOpen={setStaffOpen}
          currentUser={currentUser}
          comments={[]}
          loadingComments={false}
          newComment=""
          setNewComment={noop}
          postingComment={false}
          onPostComment={noop}
          attachments={[]}
          loadingAttachments={false}
          uploadingAttachment={false}
          attachmentInputRef={attachmentInputRef}
          onAttachmentUpload={noop}
          onViewAttachment={noop}
          activeTimeEntry={null}
          displaySeconds={0}
          formatTime={() => '0:00'}
          onStartTimer={noop}
          onStopTimer={noop}
          availableTemplates={availableTemplates}
          onTemplateChange={handleTemplateChange}
          isNewTask
          onConfirmCreate={handleConfirmCreate}
          creatingTask={creating}
        />
    </div>
  );
}
