'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput, type TaskDetailInput } from '@/components/tasks/detail/taskInput';
import type { Task, Project, User } from '@/lib/types';

interface FloatingWindowProps {
  type: 'task' | 'project';
  item: Task | Project;
  propertyName: string;
  onClose: () => void;
  /** Needed to resolve assignee names/avatars when `item` is a Project row. */
  users: User[];
  onSaved?: (row: TaskDetailInput) => void;
  onDeleted?: (taskId: string) => void;
}

// Map a Task-shaped row (task_id, assigned_users — lib/types' Task interface)
// into the unified TaskDetailInput. Mirrors projectToTaskInput, but Task
// lacks created_at/updated_at/bin_name/unread_comment_count — those fall
// back to '' / null since this shape never carries them.
function taskToTaskDetailInput(task: Task, propertyName: string): TaskDetailInput {
  return {
    task_id: task.task_id,
    reservation_id: task.reservation_id ?? null,
    property_id: task.property_id ?? null,
    property_name: propertyName || task.property_name || null,
    template_id: task.template_id ?? null,
    template_name: task.template_name ?? null,
    title: task.title ?? null,
    description: task.description ?? null,
    priority: task.priority ?? 'medium',
    department_id: task.department_id ?? null,
    department_name: task.department_name ?? null,
    status: task.status ?? 'not_started',
    scheduled_date: task.scheduled_date ?? null,
    scheduled_time: task.scheduled_time ?? null,
    form_metadata: (task.form_metadata as Record<string, unknown> | null) ?? null,
    bin_id: task.bin_id ?? null,
    bin_name: null,
    is_binned: task.is_binned ?? false,
    created_at: '',
    updated_at: '',
    assigned_users: (task.assigned_users || []).map((u) => ({
      user_id: u.user_id,
      name: u.name,
      avatar: u.avatar ?? null,
      role: u.role,
    })),
  };
}

export function FloatingWindow({
  type,
  item,
  propertyName,
  onClose,
  users,
  onSaved,
  onDeleted,
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

  const taskInput: TaskDetailInput =
    type === 'task'
      ? taskToTaskDetailInput(item as Task, propertyName)
      : projectToTaskInput(item as Project, users);

  const title = taskInput.title || taskInput.template_name || 'Task';

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

      {/* Content - unified task detail panel for both tasks and projects */}
      <div className="flex-1 overflow-hidden">
        <TaskDetailPanel
          task={taskInput}
          onClose={onClose}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
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
