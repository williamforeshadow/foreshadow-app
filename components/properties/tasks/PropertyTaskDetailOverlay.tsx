'use client';

// Thin shim over the unified TaskDetailPanel. Kept as a module so the many
// existing consumers (property pages, /tasks/[id], the global reservation /
// context overlays, TurnoversWindow, messages) keep their import + props
// contract while the panel family owns all UI and save logic.

import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import type { TaskDetailInput } from '@/components/tasks/detail/taskInput';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useIsMobile } from '@/lib/useIsMobile';

// Minimal task shape the overlay needs — the unified panel's input shape.
// Re-exported under the historical name for existing importers.
export type OverlayTaskInput = TaskDetailInput;

interface PropertyTaskDetailOverlayProps {
  task: OverlayTaskInput | null;
  onClose: () => void;
  // Called after any successful mutation so the parent can re-fetch its
  // list. Most list caches also refresh via the panel's query
  // invalidations; this remains for parents with local mirrors.
  onTaskUpdated?: () => void;
  /**
   * Visual mode for the desktop branch.
   *   - 'overlay' (default): absolute right-third panel slot.
   *   - 'page': full-bleed centered column (the /tasks/[id] route).
   * Mobile is unaffected (always full-screen).
   */
  layout?: 'overlay' | 'page';
  /** "Open in dedicated page" — renders only when provided AND layout='overlay'. */
  onOpenInPage?: () => void;
}

export function PropertyTaskDetailOverlay({
  task,
  onClose,
  onTaskUpdated,
  layout = 'overlay',
  onOpenInPage,
}: PropertyTaskDetailOverlayProps) {
  const isMobile = useIsMobile();
  if (!task) return null;

  const panel = (
    <TaskDetailPanel
      task={task}
      layout={layout === 'page' ? 'page' : 'panel'}
      onClose={onClose}
      onSaved={() => onTaskUpdated?.()}
      onDeleted={() => {
        onTaskUpdated?.();
        onClose();
      }}
      onOpenInPage={layout === 'overlay' ? onOpenInPage : undefined}
    />
  );

  if (isMobile) return panel; // panel self-renders fixed inset-0 on mobile

  const wrapperClass =
    layout === 'page'
      ? 'w-full h-full flex flex-col items-stretch overflow-hidden mx-auto max-w-3xl px-4 py-4'
      : DESKTOP_DETAIL_PANEL_FLEX;

  return <div className={wrapperClass}>{panel}</div>;
}
