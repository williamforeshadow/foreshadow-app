'use client';

import { useEffect, type RefObject } from 'react';

// Shared read-only guards for the public demos. Capture-phase listeners on
// `document` (so Radix portals — popovers/dialogs rendered outside the page
// subtree — are also covered) that stop events before React's delegated
// handlers run. No edits to the shared product components needed. Mutes the
// interactions that error against the mocked backend:
//   - opening a task's detail panel (its edit controls — description, assignee,
//     department — and attachment upload fail against mocks). Entry points:
//     kanban cards, the timeline's right-rail task rows, and the bar popover's
//     task rows;
//   - editing any contenteditable (the TipTap description editor);
//   - file-attachment uploads;
//   - the "New task" / "Open in dedicated page" buttons;
//   - links that would navigate out of /demo.
// The `stageRef` arg is kept for call-site symmetry; listeners are global.
export function useDemoGuards(_stageRef?: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const blockClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest) return;

      // navigation out of /demo
      const link = target.closest('a');
      const href = link?.getAttribute('href') || '';
      if (href.startsWith('/') && !href.startsWith('/demo')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      // task card in a kanban board → keep the detail panel from opening
      const roleBtn = target.closest('[role="button"]');
      if (roleBtn && roleBtn.closest('[data-kanban-board]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      // A clickable task row that would open the task detail panel. Two homes:
      //   - the timeline right rail (DESKTOP_TIMELINE_DETAIL_PANEL_CLASS:
      //     right-0 + w-1/3 + z-20);
      //   - the reservation bar's Radix popover (portaled to <body>).
      // Block the row click but leave buttons/links (close, view toggles).
      const inRightRail = target.closest(
        '[class*="right-0"][class*="w-1/3"][class*="z-20"]',
      );
      const inPopover = target.closest('[data-radix-popper-content-wrapper]');
      if ((inRightRail || inPopover) && !target.closest('button')) {
        const row = target.closest('div[class*="cursor-pointer"]');
        if (row) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }

      // create / open-in-dedicated-page buttons
      const btn = target.closest('button');
      if (btn) {
        const title = (btn.getAttribute('title') || '').trim().toLowerCase();
        const text = (btn.textContent || '').trim().toLowerCase();
        if (
          title === 'create task' ||
          title.startsWith('add task') ||
          title === 'open in dedicated page' ||
          text === 'new task' ||
          text.startsWith('add task')
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };

    // Make TipTap / any contenteditable read-only (block text mutations). The
    // agent input is a <textarea>, not contenteditable, so it's unaffected.
    const blockEdit = (e: Event) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[contenteditable="true"], [contenteditable=""]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    // Swallow file-attachment uploads (the picked file would hit the mocked
    // backend and error).
    const blockFile = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement && target.type === 'file') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    const d = document;
    d.addEventListener('click', blockClick, true);
    d.addEventListener('beforeinput', blockEdit, true);
    d.addEventListener('paste', blockEdit, true);
    d.addEventListener('cut', blockEdit, true);
    d.addEventListener('drop', blockEdit, true);
    d.addEventListener('change', blockFile, true);
    return () => {
      d.removeEventListener('click', blockClick, true);
      d.removeEventListener('beforeinput', blockEdit, true);
      d.removeEventListener('paste', blockEdit, true);
      d.removeEventListener('cut', blockEdit, true);
      d.removeEventListener('drop', blockEdit, true);
      d.removeEventListener('change', blockFile, true);
    };
  }, []);
}
