'use client';

import * as React from 'react';
import { useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { useIsMobile } from '@/lib/useIsMobile';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { useNativeKeyboardHeight } from '@/lib/nativeKeyboard';
import { useEditableKeyboardOverlay } from '@/lib/useEditableKeyboardOverlay';
import { AttachmentLightbox } from '@/components/windows/projects/AttachmentLightbox';
import type { ProjectFormFields } from '@/lib/types';
import { useTaskDetailController } from './useTaskDetailController';
import { type TaskDetailInput } from './taskInput';
import { ChecklistPage } from './ChecklistPage';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';
import { AdaptivePicker } from './primitives/AdaptivePicker';
import { TaskOptionRow } from './primitives/TaskSheet';
import { HeaderBar, TitleSection, DescriptionSection, IconButton } from './sections/HeaderSections';
import { TimerRail, ActionBar } from './sections/StatusSections';
import { ContextChips, TaskMetaFields, StepsSection, CrewSection, AttachmentsSection } from './sections/BodySections';
import { CommentsSection } from './sections/CommentsView';

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
  demo,
}: TaskDetailPanelProps) {
  const isMobile = useIsMobile() ?? false;
  const c = useTaskDetailController({ task, onSaved, onDeleted, demo });
  const [menuOpen, setMenuOpen] = useState(false);
  // Create-task panel launched from the checklist header "+", seeded with
  // this task's property so it opens locked to the same property.
  const [creatingOpen, setCreatingOpen] = useState(false);
  // Keyboard-up detection needs both signals: visualViewport (web/Android)
  // and the native plugin (which fires regardless of resize mode on iOS).
  const visualKeyboardInset = useKeyboardInset();
  const nativeKeyboardInset = useNativeKeyboardHeight();
  const keyboardUp = Math.max(visualKeyboardInset, nativeKeyboardInset) > 0;
  // Main-view scroll body: title + description get the overlay-keyboard
  // treatment (screen stays put, container scrolls the caret above the
  // keyboard itself).
  const mainScrollRef = React.useRef<HTMLDivElement>(null);
  const mainKb = useEditableKeyboardOverlay(mainScrollRef);

  if (!task) return null;

  const templateName = c.templateName;
  const propertyName = task?.property_name ?? null;
  // The top-bar micro-label shows the property name (or nothing when the task
  // has no property).
  const headerLabel = propertyName ?? '';

  // Create-task overlay (self-positions fixed inset-0). Rendered as a sibling
  // of the panel body in each layout — NOT inside the desktop card, whose
  // overflow-hidden would clip this non-portaled fixed element.
  const createPanel = creatingOpen ? (
    <CreateTaskPanel
      seed={{
        property_id: task.property_id ?? null,
        property_name: propertyName,
      }}
      onClose={() => setCreatingOpen(false)}
      onCreated={() => setCreatingOpen(false)}
    />
  ) : null;

  const timerRunning = !!c.timeHook.activeTimeEntry;
  const checklistComplete = c.progress.total > 0 && c.progress.completed === c.progress.total;
  const editingLocked = c.isContingent;

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
      {(
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

      {/* Content zone — the checklist takeover overlays this wrapper only, so
          the ActionBar below stays visible (and live) in both views. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
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
      <div
        ref={mainScrollRef}
        className="flex-1 overflow-y-auto px-[18px] pt-2"
        style={{ scrollbarWidth: 'none', paddingBottom: mainKb.keyboardPadding }}
        {...mainKb.handlers}
      >
        <div className={layout === 'page' ? 'mx-auto w-full max-w-2xl' : undefined}>
          <TitleSection
            title={c.fields.title}
            onTitleChange={(v) => c.updateField('title', v, false)}
            onTitleBlur={() => void c.saveFields()}
            readOnly={editingLocked}
          />
          {c.propertyAddress && (
            <div
              className="mt-0.5 truncate text-[length:var(--task-fs-body-sm)]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              {c.propertyAddress}
            </div>
          )}
          {(
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
            readOnly={editingLocked}
            status={c.fields.status}
            isTemplated={c.isTemplated}
            isContingent={c.isContingent}
            onSelectStatus={(s) => c.writeStatus(s)}
            scheduledDate={c.fields.scheduled_date}
            scheduledTime={c.fields.scheduled_time}
            priority={c.fields.priority}
            propertyId={task?.property_id ?? null}
            onScheduleChange={(date, time) => {
              const updated = { ...c.fields, scheduled_date: date, scheduled_time: time };
              c.updateField('scheduled_date', date, false);
              c.updateField('scheduled_time', time, false);
              void c.saveFields(updated as ProjectFormFields);
            }}
            onPriorityChange={(p) => c.updateField('priority', p as ProjectFormFields['priority'])}
          />

          {c.isTemplated && (
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
            style={{
              borderColor: 'var(--task-line-soft)',
              // The scroll body must clear the home indicator.
              paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
            }}
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
              binId={c.row?.bin_id ?? null}
              binName={c.row?.bin_name ?? null}
              isBinned={c.row?.is_binned ?? false}
              bins={c.bins}
              departmentId={c.fields.department_id}
              departments={c.departments}
              onBinChange={(binId, isBinned) => void c.updateBin(binId, isBinned)}
              onDepartmentChange={(id) => c.updateField('department_id', id)}
            />
            {(
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
            <CommentsSection
              comments={c.commentsHook.projectComments}
              loading={c.commentsHook.loadingComments}
              authorName={c.currentUser?.name ?? null}
              newComment={c.commentsHook.newComment}
              setNewComment={c.commentsHook.setNewComment}
              posting={c.commentsHook.postingComment}
              onPost={(text) => void c.commentsHook.postProjectComment(task.task_id, text, 'task')}
            />
          </div>
        </div>
      </div>

      {/* takeover views (inside the content wrapper — ActionBar stays below) */}
      {c.view === 'checklist' && task && (
        <ChecklistPage
          taskId={task.task_id}
          propertyName={propertyName}
          propertyAddress={c.propertyAddress}
          template={c.template}
          formMetadata={c.formMetadata}
          onSaveForm={c.saveForm}
          readOnly={c.isChecklistReadOnly}
          loading={c.loadingTemplate}
          completed={c.progress.completed}
          total={c.progress.total}
          onBack={() => void c.openView('main')}
          onCreateTask={() => setCreatingOpen(true)}
          title={c.fields.title}
          timerRunning={timerRunning}
          displaySeconds={c.timeHook.displaySeconds}
          formatTime={c.timeHook.formatTime}
          onTimerToggle={undefined /* templated: timer is action-driven */}
          timerToggleDisabled
        />
      )}
      </div>

      {/* Status matrix: checklist view only — the main detail view is
          button-free for every task. Non-templated tasks change status via
          the badge; contingent tasks see "Awaiting approval" here. When the
          keyboard is up on mobile it stays down instead of riding above it. */}
      {c.view === 'checklist' && !(isMobile && keyboardUp) && (
        <ActionBar
          isMobile={isMobile}
          isContingent={c.isContingent}
          isTemplated={c.isTemplated}
          status={c.fields.status}
          checklistComplete={checklistComplete}
          onStart={() => void c.handleStart()}
          onPause={() => void c.handlePause()}
          onComplete={() => void c.handleComplete()}
          onReopen={() => c.handleReopen()}
          onWriteStatus={(s) => c.writeStatus(s)}
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
    // Full-screen on mobile covers the status bar / notch, so inset the whole
    // panel below it — otherwise the back chevron and overflow menu sit under
    // it and can't be tapped. Padding here (rather than in each header) also
    // covers the checklist/comments takeovers, which are absolute inset-0
    // inside this container. The action bar handles the bottom inset itself.
    return (
      <div
        className="task-detail safe-area-top fixed inset-0 z-50"
        style={{ background: 'var(--task-surface-0)' }}
      >
        {body}
        {createPanel}
      </div>
    );
  }
  if (layout === 'page') {
    return (
      <>
        {body}
        {createPanel}
      </>
    );
  }
  // Desktop 'panel' layout: a floating popup card — vertically centered and
  // right-anchored inside its (transparent) host slot, height-capped so it
  // reads as a compact square-ish card rather than a full-height column, and
  // borderless (shadow alone lifts it off the page).
  return (
    <>
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
      {createPanel}
    </>
  );
}
