'use client';

import { useState, useRef, useCallback, useEffect, RefObject } from 'react';
import { ProjectDetailPanel } from '../projects';
import type { Task, Project, User, ProjectFormFields, Comment, Attachment, TimeEntry, ProjectBin } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

interface FloatingWindowProps {
  type: 'task' | 'project';
  item: Task | Project;
  propertyName: string;
  onClose: () => void;
  currentUser: User | null;
  // Unified detail panel props (used for both tasks and projects)
  users: User[];
  editingFields: ProjectFormFields | null;
  setEditingFields: (fields: ProjectFormFields | null | ((prev: ProjectFormFields | null) => ProjectFormFields | null)) => void;
  savingEdit: boolean;
  onSave: (fields?: ProjectFormFields) => void;
  onDelete: (item: Project) => void;
  onOpenActivity: () => void;
  // Comments
  comments: Comment[];
  loadingComments: boolean;
  newComment: string;
  setNewComment: (comment: string) => void;
  postingComment: boolean;
  onPostComment: () => void;
  // Attachments
  attachments: Attachment[];
  loadingAttachments: boolean;
  uploadingAttachment: boolean;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  onAttachmentUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onViewAttachment: (index: number) => void;
  // Time tracking
  activeTimeEntry: TimeEntry | null;
  displaySeconds: number;
  formatTime: (seconds: number) => string;
  onStartTimer: () => void;
  onStopTimer: () => void;
  // Popover states
  staffOpen: boolean;
  setStaffOpen: (open: boolean) => void;
  // Template/checklist (for tasks)
  template?: Template | null;
  formMetadata?: Record<string, unknown>;
  onSaveForm?: (formData: Record<string, unknown>) => Promise<void>;
  loadingTemplate?: boolean;
  onValidationChange?: (allRequiredFilled: boolean) => void;
  // Optional extras
  allProperties?: Array<{ id: string | null; name: string }>;
  bins?: ProjectBin[];
  onBinChange?: (binId: string | null, binName: string | null) => void;
  onIsBinnedChange?: (isBinned: boolean) => void;
  onPropertyChange?: (propertyId: string | null, propertyName: string | null) => void;
}

export function FloatingWindow({
  type,
  item,
  propertyName,
  onClose,
  currentUser,
  users,
  editingFields,
  setEditingFields,
  savingEdit,
  onSave,
  onDelete,
  onOpenActivity,
  comments,
  loadingComments,
  newComment,
  setNewComment,
  postingComment,
  onPostComment,
  attachments,
  loadingAttachments,
  uploadingAttachment,
  attachmentInputRef,
  onAttachmentUpload,
  onViewAttachment,
  activeTimeEntry,
  displaySeconds,
  formatTime,
  onStartTimer,
  onStopTimer,
  staffOpen,
  setStaffOpen,
  template,
  formMetadata,
  onSaveForm,
  loadingTemplate,
  onValidationChange,
  allProperties,
  bins,
  onBinChange,
  onIsBinnedChange,
  onPropertyChange,
}: FloatingWindowProps) {
  // Position state - calculate initial position to be 3/4 to the right
  const [position, setPosition] = useState(() => {
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    return {
      x: Math.round(windowWidth * 0.75 - 187), // 75% across, minus half the width
      y: Math.round(windowHeight * 0.1), // 10% from top
    };
  });
  
  // Size state - start at default, allow resizing
  const [size, setSize] = useState({ width: 375, height: 600 });
  const minSize = { width: 320, height: 400 };
  
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the header
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    };
  }, [size]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    } else if (isResizing) {
      const deltaX = e.clientX - resizeStart.current.x;
      const deltaY = e.clientY - resizeStart.current.y;
      setSize({
        width: Math.max(minSize.width, resizeStart.current.width + deltaX),
        height: Math.max(minSize.height, resizeStart.current.height + deltaY),
      });
    }
  }, [isDragging, isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  // Add global mouse listeners when dragging or resizing
  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  const title = type === 'task'
    ? (item as Task).title || (item as Task).template_name || 'Task'
    : (item as Project).title;

  return (
    <div
      className="fixed z-50 bg-card dark:bg-[var(--timeline-surface-4)] rounded-xl shadow-2xl border border-neutral-200 dark:border-[var(--timeline-border-strong)] overflow-hidden flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Draggable Header */}
      <div
        onMouseDown={handleMouseDown}
        className={`flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-neutral-700 flex-shrink-0 ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } select-none bg-neutral-50 dark:bg-[var(--timeline-surface-3)]`}
      >
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm truncate">{title}</h3>
          <p className="text-xs text-muted-foreground truncate">{propertyName}</p>
        </div>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking close
          className="p-1.5 hover:bg-neutral-200 dark:hover:bg-[var(--timeline-hover)] rounded-lg transition-colors ml-2 flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* Content - Unified detail panel for both tasks and projects */}
      <div className="flex-1 overflow-auto overscroll-contain [&>div]:h-full [&>div]:w-full [&>div]:border-l-0">
        {editingFields ? (
          <ProjectDetailPanel
            project={type === 'task' ? {
              id: (item as Task).task_id,
              property_name: propertyName || null,
              bin_id: (item as Task).bin_id || null,
              title: (item as Task).title || (item as Task).template_name || 'Task',
              description: (item as Task).description || null,
              status: (item as Task).status as Project['status'],
              priority: ((item as Task).priority || 'medium') as Project['priority'],
              department_id: (item as Task).department_id || null,
              department_name: (item as Task).department_name || null,
              scheduled_date: (item as Task).scheduled_date || null,
              scheduled_time: (item as Task).scheduled_time || null,
              reservation_id: (item as Task).reservation_id ?? null,
              project_assignments: ((item as Task).assigned_users || []).map(u => ({
                user_id: u.user_id,
                user: { id: u.user_id, name: u.name, avatar: u.avatar, role: u.role }
              })),
              created_at: '',
              updated_at: '',
            } : item as Project}
            editingFields={editingFields}
            setEditingFields={setEditingFields}
            users={users}
            allProperties={allProperties}
            savingEdit={savingEdit}
            onSave={onSave}
            onDelete={onDelete}
            onClose={onClose}
            onOpenActivity={onOpenActivity}
            onPropertyChange={onPropertyChange}
            bins={bins}
            onBinChange={onBinChange}
            onIsBinnedChange={onIsBinnedChange}
            comments={comments}
            loadingComments={loadingComments}
            newComment={newComment}
            setNewComment={setNewComment}
            postingComment={postingComment}
            onPostComment={onPostComment}
            attachments={attachments}
            loadingAttachments={loadingAttachments}
            uploadingAttachment={uploadingAttachment}
            attachmentInputRef={attachmentInputRef}
            onAttachmentUpload={onAttachmentUpload}
            onViewAttachment={onViewAttachment}
            activeTimeEntry={activeTimeEntry}
            displaySeconds={displaySeconds}
            formatTime={formatTime}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
            staffOpen={staffOpen}
            setStaffOpen={setStaffOpen}
            template={template}
            formMetadata={formMetadata}
            onSaveForm={onSaveForm}
            loadingTemplate={loadingTemplate}
            currentUser={currentUser}
            onValidationChange={onValidationChange}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        )}
      </div>

      {/* Resize Handle - Bottom Right Corner */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{ touchAction: 'none' }}
      >
        <svg
          className="w-4 h-4 text-neutral-400"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
        </svg>
      </div>
    </div>
  );
}
