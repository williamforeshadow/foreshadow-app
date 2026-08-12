'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ChipButton, RowIconButton, SectionLabel } from '@/components/ui/panel/PanelForm';
import { DeptGlyph } from '@/components/tasks/DeptGlyph';
import DeptIconPicker from '@/components/departments/DeptIconPicker';
import { useDepartments } from '@/lib/departmentsContext';
import { WindowHeader } from '@/components/ui/window-header';
import { LoadingState } from '@/components/ui/loading-state';
import type { Department } from '@/lib/types';

/** Matched to the other index pages so the section lines up. */
const DETAIL_COL = 'mx-auto w-full max-w-[46rem]';

const ICONS = {
  pencil: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10a2.5 2.5 0 10-3.5-3.5L4.5 16.5 4 20z" />
    </svg>
  ),
  trash: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l.9 12.1A2 2 0 008.9 21h6.2a2 2 0 002-1.9L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
};

export default function DepartmentsPage() {
  const router = useRouter();
  const { departments, loading, refreshDepartments } = useDepartments();
  const [error, setError] = useState<string | null>(null);

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('folder');
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('folder');
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Icon picker popover
  const [iconPickerOpen, setIconPickerOpen] = useState<string | null>(null); // 'create' | 'edit' | null

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), icon: newIcon }),
      });
      const data = await res.json();
      if (res.ok && data.department) {
        await refreshDepartments();
        setShowCreateDialog(false);
        setNewName('');
        setNewIcon('folder');
      } else {
        setError(data.error || 'Failed to create department');
      }
    } catch {
      setError('Failed to create department');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (dept: Department) => {
    setEditingId(dept.id);
    setEditName(dept.name);
    setEditIcon(dept.icon || 'folder');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditIcon('folder');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/departments/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), icon: editIcon }),
      });
      const data = await res.json();
      if (res.ok && data.department) {
        await refreshDepartments();
        cancelEdit();
      } else {
        setError(data.error || 'Failed to update department');
      }
    } catch {
      setError('Failed to update department');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        await refreshDepartments();
        setDeletingId(null);
      } else {
        setDeleteError(data.error || 'Failed to delete department');
      }
    } catch {
      setDeleteError('Failed to delete department');
    }
  };

  return (
    <>
      <WindowHeader title="Departments" />
      <div
        className="panel-form flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--task-surface-0)' }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className={DETAIL_COL}>
            <div
              className="flex items-center justify-between gap-3 border-b px-[18px] py-3"
              style={{ borderColor: 'var(--task-line-soft)' }}
            >
              <SectionLabel className="!px-0 !pb-0 !pt-0">
                {loading
                  ? 'Departments'
                  : `${departments.length} department${departments.length === 1 ? '' : 's'}`}
              </SectionLabel>
              <ChipButton set onClick={() => setShowCreateDialog(true)}>
                + New department
              </ChipButton>
            </div>

            {(error || deleteError) && (
              <div
                className="mx-[18px] mt-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-[length:var(--task-fs-body-sm)]"
                style={{
                  borderColor: 'var(--task-amber)',
                  background: 'var(--task-amber-soft)',
                  color: 'var(--task-amber)',
                }}
              >
                <span>{error || deleteError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setDeleteError(null);
                    setDeletingId(null);
                  }}
                  aria-label="Dismiss"
                  className="shrink-0"
                >
                  ✕
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center px-[18px] py-12">
                <LoadingState />
              </div>
            ) : departments.length === 0 ? (
              <div className="px-[18px] py-12 text-center">
                <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                  No departments yet.
                </p>
                <p
                  className="mt-1.5 text-[length:var(--task-fs-body-sm)]"
                  style={{ color: 'var(--task-ink-3)' }}
                >
                  Departments organize templates, tasks, and projects.
                </p>
                <div className="mt-4 flex justify-center">
                  <ChipButton set onClick={() => setShowCreateDialog(true)}>
                    + New department
                  </ChipButton>
                </div>
              </div>
            ) : (
              departments.map((dept) => {
                const isEditing = editingId === dept.id;

                if (isEditing) {
                  return (
                    <div
                      key={dept.id}
                      className="flex items-center gap-2.5 border-b px-[18px] py-2.5"
                      style={{
                        borderColor: 'var(--task-line-soft)',
                        background: 'var(--task-surface-1)',
                      }}
                    >
                      <DeptIconPicker
                        open={iconPickerOpen === 'edit'}
                        onOpenChange={(open) => setIconPickerOpen(open ? 'edit' : null)}
                        value={editIcon}
                        onSelect={setEditIcon}
                      />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Department name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="min-w-0 flex-1 bg-transparent text-[length:var(--task-fs-option)] outline-none placeholder:text-[var(--task-ink-3)]"
                        style={{ color: 'var(--task-ink-1)' }}
                      />
                      <ChipButton set={false} onClick={cancelEdit}>
                        Cancel
                      </ChipButton>
                      <ChipButton
                        set
                        onClick={handleSaveEdit}
                        disabled={saving || !editName.trim()}
                        style={
                          saving || !editName.trim()
                            ? { opacity: 0.45 }
                            : { background: 'var(--task-accent)', color: '#fff' }
                        }
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </ChipButton>
                    </div>
                  );
                }

                return (
                  <div
                    key={dept.id}
                    className="flex items-center gap-2.5 border-b px-[18px] py-2.5 transition-colors hover:bg-[var(--task-surface-1)]"
                    style={{ borderColor: 'var(--task-line-soft)' }}
                  >
                    {/* The row opens the detail page; the two affordances on
                        the right are siblings, not nested buttons. */}
                    <button
                      type="button"
                      onClick={() => router.push(`/departments/${dept.id}`)}
                      aria-label={`Open ${dept.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span className="shrink-0">
                        <DeptGlyph iconKey={dept.icon} size={17} />
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-[length:var(--task-fs-option)]"
                        style={{ color: 'var(--task-ink-1)' }}
                      >
                        {dept.name}
                      </span>
                    </button>

                    <RowIconButton label="Edit department" onClick={() => startEdit(dept)}>
                      {ICONS.pencil}
                    </RowIconButton>
                    <RowIconButton
                      danger
                      label="Delete department"
                      onClick={() => {
                        if (deletingId === dept.id) return;
                        if (confirm(`Delete "${dept.name}"? This cannot be undone.`)) {
                          handleDelete(dept.id);
                        }
                      }}
                    >
                      {ICONS.trash}
                    </RowIconButton>
                    <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
                      {ICONS.chevron}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Create Department Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="panel-form max-w-md p-0" style={{ background: 'var(--task-surface-0)' }}>
          <DialogHeader className="px-[18px] pt-4">
            <DialogTitle
              className="text-[length:var(--task-fs-option)]"
              style={{ color: 'var(--task-ink-1)' }}
            >
              New Department
            </DialogTitle>
            <DialogDescription
              className="text-[length:var(--task-fs-body-sm)]"
              style={{ color: 'var(--task-ink-3)' }}
            >
              Departments organize templates, tasks, and projects.
            </DialogDescription>
          </DialogHeader>

          <div>
            <SectionLabel>Icon and name</SectionLabel>
            <div
              className="flex items-center gap-2.5 border-y px-[18px] py-2.5"
              style={{ borderColor: 'var(--task-line-soft)' }}
            >
              <DeptIconPicker
                open={iconPickerOpen === 'create'}
                onOpenChange={(open) => setIconPickerOpen(open ? 'create' : null)}
                value={newIcon}
                onSelect={setNewIcon}
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Department name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) handleCreate();
                }}
                className="min-w-0 flex-1 bg-transparent text-[length:var(--task-fs-option)] outline-none placeholder:text-[var(--task-ink-3)]"
                style={{ color: 'var(--task-ink-1)' }}
              />
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 px-[18px] pb-4">
            <button
              type="button"
              onClick={() => setShowCreateDialog(false)}
              className="h-[46px] shrink-0 rounded-xl border px-5 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
              style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="h-[46px] flex-1 rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--task-accent)', color: '#fff' }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
