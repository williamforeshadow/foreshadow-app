'use client';

import * as React from 'react';
import { useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { useIsMobile } from '@/lib/useIsMobile';
import { AttachmentLightbox } from '@/components/windows/projects/AttachmentLightbox';
import type { ProjectFormFields } from '@/lib/types';
import { useTaskDetailController, type TaskCreatePayload } from './useTaskDetailController';
import { emptyDraft, type TaskDetailInput, type TaskDraft } from './taskInput';
import { ChecklistPage } from './ChecklistPage';
import { AdaptivePicker } from './primitives/AdaptivePicker';
import { TaskOptionRow } from './primitives/TaskSheet';
import { HeaderBar, TitleSection, DescriptionSection, IconButton } from './sections/HeaderSections';
import { TimerRail, ActionBar } from './sections/StatusSections';
import { ContextChips, TaskMetaFields, StepsSection, CrewSection, AttachmentsSection } from './sections/BodySections';
import { CommentsView } from './sections/CommentsView';

export interface TaskDetailPanelProps {
  task: TaskDetailInput | null;
  /** Desktop chrome density; mobile is always full-screen. */
  layout?: 'panel' | 'page';
  onClose: () => void;
  onSaved?: (row: TaskDetailInput) => void;
  onDeleted?: (taskId: string) => void;
  onOpenInPage?: () => void;
  /** Extra header slot (e.g. TurnoverProjectsPanel's back affordance). */
  headerAccessory?: React.ReactNode;
  // Draft (new-task) mode:
  draft?: TaskDraft | null;
  onConfirmCreate?: (payload: TaskCreatePayload) => Promise<void> | void;
  creating?: boolean;
  onDraftChange?: (draft: TaskDraft) => void;
  /** Demo fixtures mode: saves apply locally, no network. */
  demo?: boolean;
}

export function TaskDetailPanel({
  task,
  layout = 'panel',
  onClose,
  onSaved,
  onDeleted,
  onOpenInPage,
  headerAccessory,
  draft,
  onConfirmCreate,
  creating,
  onDraftChange,
  demo,
}: TaskDetailPanelProps) {
  const isMobile = useIsMobile() ?? false;
  const c = useTaskDetailController({ task, draft, onSaved, onDeleted, onDraftChange, demo });
  const [menuOpen, setMenuOpen] = useState(false);

  if (!task && !draft) return null;

  const templateName = task?.template_name ?? draft?.template_name ?? null;
  const propertyName = task?.property_name ?? draft?.property_name ?? null;
  // The top-bar micro-label shows the property name (or nothing when the task
  // has no property).
  const headerLabel = propertyName ?? '';

  const timerRunning = !!c.timeHook.activeTimeEntry;
  const checklistComplete = c.progress.total > 0 && c.progress.completed === c.progress.total;
  const editingLocked = c.isContingent;

  const handleCreate = () => {
    if (!onConfirmCreate) return;
    const d = draft ?? emptyDraft();
    void onConfirmCreate({
      fields: c.fields,
      property_id: d.property_id,
      property_name: d.property_name,
      template_id: d.template_id,
      bin_id: d.bin_id,
    });
  };

  const menu = (
    <AdaptivePicker
      open={menuOpen}
      onOpenChange={setMenuOpen}
      title="Task"
      align="end"
      trigger={
        <IconButton label="More">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="6" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="18" cy="12" r="1.6" />
          </svg>
        </IconButton>
      }
    >
      {onOpenInPage && layout !== 'page' && (
        <TaskOptionRow
          onSelect={() => {
            setMenuOpen(false);
            onOpenInPage();
          }}
        >
          Open in page
        </TaskOptionRow>
      )}
      {!c.isDraft && (
        <TaskOptionRow
          onSelect={() => {
            setMenuOpen(false);
            if (confirm('Delete this task? This cannot be undone.')) void c.deleteTask();
          }}
        >
          <span style={{ color: '#d97757' }}>{c.deleting ? 'Deleting…' : 'Delete task'}</span>
        </TaskOptionRow>
      )}
    </AdaptivePicker>
  );

  const body = (
    <div className="task-detail relative flex h-full w-full flex-col overflow-hidden" style={{ background: 'var(--task-surface-0)' }}>
      <style>{`@keyframes task-pulse { 0%,100%{opacity:.35} 50%{opacity:1} }`}</style>

      {/* header zone */}
      {/* Sticky top bar — only the close/label/menu chrome stays pinned. */}
      <div className="shrink-0 px-[18px] pt-2">
        <HeaderBar
          label={headerLabel}
          onClose={onClose}
          closeGlyph={isMobile ? 'back' : 'x'}
          menu={menu}
          accessory={headerAccessory}
        />
      </div>

      {/* scroll body — title, timer, and status scroll with everything else */}
      <div className="flex-1 overflow-y-auto px-[18px] pt-2" style={{ scrollbarWidth: 'none' }}>
        <div className={layout === 'page' ? 'mx-auto w-full max-w-2xl' : undefined}>
          <TitleSection
            title={c.fields.title}
            onTitleChange={(v) => c.updateField('title', v, false)}
            onTitleBlur={() => void c.saveFields()}
            readOnly={editingLocked}
          />
          {!c.isDraft && (
            <TimerRail
              running={timerRunning}
              displaySeconds={c.timeHook.displaySeconds}
              formatTime={c.timeHook.formatTime}
              onToggle={
                c.isTemplated
                  ? undefined
                  : timerRunning
                    ? () => c.timeHook.stopProjectTimer()
                    : () => c.startTimer()
              }
              toggleDisabled={c.isTemplated || editingLocked}
            />
          )}
          <div className="mt-3.5" />
          <ContextChips
            isDraft={c.isDraft}
            readOnly={editingLocked}
            status={c.fields.status}
            isTemplated={c.isTemplated}
            isContingent={c.isContingent}
            onSelectStatus={(s) => c.writeStatus(s)}
            scheduledDate={c.fields.scheduled_date}
            scheduledTime={c.fields.scheduled_time}
            priority={c.fields.priority}
            propertyId={task?.property_id ?? draft?.property_id ?? null}
            onScheduleChange={(date, time) => {
              const updated = { ...c.fields, scheduled_date: date, scheduled_time: time };
              c.updateField('scheduled_date', date, false);
              c.updateField('scheduled_time', time, false);
              void c.saveFields(updated as ProjectFormFields);
            }}
            onPriorityChange={(p) => c.updateField('priority', p as ProjectFormFields['priority'])}
          />

          {c.isTemplated && !c.isDraft && (
            <StepsSection
              completed={c.progress.completed}
              total={c.progress.total}
              templateName={templateName}
              loading={c.loadingTemplate}
              onOpen={() => void c.openView('checklist')}
            />
          )}

          <div className="mt-4">
            <DescriptionSection
              description={(c.fields.description as JSONContent | null) ?? null}
              onChange={(json) => c.updateField('description', json, false)}
              onBlur={() => void c.saveFields()}
              readOnly={editingLocked}
              collapsedByDefault={c.isTemplated}
            />
          </div>

          <div
            className="mt-4 flex flex-col gap-[18px] border-t pt-4"
            style={{ borderColor: 'var(--task-line-soft)', paddingBottom: '1.25rem' }}
          >
            <CrewSection
              users={c.users}
              assignedIds={c.fields.assigned_staff ?? []}
              readOnly={editingLocked}
              onToggleUser={(userId) => {
                const current = c.fields.assigned_staff ?? [];
                const next = current.includes(userId)
                  ? current.filter((id) => id !== userId)
                  : [...current, userId];
                c.updateField('assigned_staff', next);
              }}
            />
            <TaskMetaFields
              readOnly={editingLocked}
              binId={c.isDraft ? (draft?.bin_id ?? null) : (c.row?.bin_id ?? null)}
              binName={c.row?.bin_name ?? null}
              isBinned={c.isDraft ? (draft?.is_binned ?? false) : (c.row?.is_binned ?? false)}
              bins={c.bins}
              departmentId={c.fields.department_id}
              departments={c.departments}
              onBinChange={(binId, isBinned) => void c.updateBin(binId, isBinned)}
              onDepartmentChange={(id) => c.updateField('department_id', id)}
            />
            {!c.isDraft && (
              <AttachmentsSection
                attachments={c.attachmentsHook.projectAttachments}
                uploading={c.attachmentsHook.uploadingAttachment}
                inputRef={c.attachmentsHook.attachmentInputRef}
                onUpload={(e) => {
                  if (task) void c.attachmentsHook.handleAttachmentUpload(e, task.task_id, 'task');
                }}
                onView={(i) => c.attachmentsHook.setViewingAttachmentIndex(i)}
                readOnly={editingLocked}
              />
            )}
          </div>
        </div>
      </div>

      <ActionBar
        isMobile={isMobile}
        isDraft={c.isDraft}
        isContingent={c.isContingent}
        isTemplated={c.isTemplated}
        status={c.fields.status}
        checklistComplete={checklistComplete}
        unreadDot={(task?.unread_comment_count ?? 0) > 0}
        creating={creating}
        onOpenComments={() => void c.openView('comments')}
        onStart={() => void c.handleStart()}
        onPause={() => void c.handlePause()}
        onComplete={() => void c.handleComplete()}
        onReopen={() => c.handleReopen()}
        onWriteStatus={(s) => c.writeStatus(s)}
        onCreate={handleCreate}
      />

      {/* takeover views */}
      {c.view === 'checklist' && task && (
        <ChecklistPage
          taskId={task.task_id}
          propertyName={propertyName}
          template={c.template}
          templateName={templateName}
          formMetadata={c.formMetadata}
          onSaveForm={c.saveForm}
          readOnly={c.isChecklistReadOnly}
          loading={c.loadingTemplate}
          completed={c.progress.completed}
          total={c.progress.total}
          onBack={() => void c.openView('main')}
        />
      )}
      {c.view === 'comments' && task && (
        <CommentsView
          isMobile={isMobile}
          comments={c.commentsHook.projectComments}
          loading={c.commentsHook.loadingComments}
          newComment={c.commentsHook.newComment}
          setNewComment={c.commentsHook.setNewComment}
          posting={c.commentsHook.postingComment}
          onPost={() => void c.commentsHook.postProjectComment(task.task_id, undefined, 'task')}
          onBack={() => void c.openView('main')}
        />
      )}

      <AttachmentLightbox
        attachments={c.attachmentsHook.projectAttachments}
        viewingIndex={c.attachmentsHook.viewingAttachmentIndex}
        onClose={() => c.attachmentsHook.setViewingAttachmentIndex(null)}
        onNavigate={(i) => c.attachmentsHook.setViewingAttachmentIndex(i)}
      />
    </div>
  );

  if (isMobile) {
    return <div className="fixed inset-0 z-50">{body}</div>;
  }
  if (layout === 'page') {
    return body;
  }
  // Desktop 'panel' layout: a floating popup card — vertically centered and
  // right-anchored inside its (transparent) host slot, height-capped so it
  // reads as a compact square-ish card rather than a full-height column, and
  // borderless (shadow alone lifts it off the page).
  return (
    <div className="pointer-events-none flex h-full w-full items-center justify-end px-4 py-5">
      <div
        className="pointer-events-auto flex h-full max-h-[640px] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl"
        style={{
          boxShadow:
            '0 24px 70px -12px rgba(0,0,0,0.55), 0 8px 24px -8px rgba(0,0,0,0.4)',
        }}
      >
        {body}
      </div>
    </div>
  );
}
