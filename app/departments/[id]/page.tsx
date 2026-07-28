'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import {
  ChipButton,
  MetaChip,
  RowIconButton,
  SectionLabel,
} from '@/components/ui/panel/PanelForm';
import { DeptGlyph } from '@/components/tasks/DeptGlyph';
import DeptIconPicker from '@/components/departments/DeptIconPicker';
import { cn } from '@/lib/utils';
import { useDepartments } from '@/lib/departmentsContext';
import { useAuth } from '@/lib/authContext';
import type { Department, DepartmentMember } from '@/lib/types';

// Role dot colors mirror the sidebar/mobile-drawer badge palette.
const ROLE_COLORS: Record<string, string> = {
  superadmin: 'bg-purple-500',
  manager: 'bg-blue-500',
  staff: 'bg-emerald-500',
  vendor: 'bg-amber-500',
};

/** Matched to the other index pages so the section lines up. */
const DETAIL_COL = 'mx-auto w-full max-w-[46rem]';

const ICONS = {
  back: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
    </svg>
  ),
  close: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

export default function DepartmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const router = useRouter();
  const { refreshDepartments } = useDepartments();
  const { allUsers, role } = useAuth();
  const canManageMembers = role === 'superadmin' || role === 'manager';

  const [department, setDepartment] = useState<Department | null>(null);
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit state — inline on the header row rather than a dialog.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('folder');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Member ops
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/departments/${id}`, { cache: 'no-store' });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load department');
      setDepartment(data.department as Department);
      setMembers(Array.isArray(data.members) ? (data.members as DepartmentMember[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load department');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const memberIdSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // Users not yet in this department, optionally filtered by the search box.
  const addableUsers = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return allUsers
      .filter((u) => !memberIdSet.has(u.id))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q));
  }, [allUsers, memberIdSet, addQuery]);

  const openEdit = () => {
    if (!department) return;
    setEditName(department.name);
    setEditIcon(department.icon || 'folder');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditName('');
    setEditIcon('folder');
  };

  const handleSaveEdit = async () => {
    if (!department || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/departments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), icon: editIcon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update department');
      setDepartment(data.department as Department);
      await refreshDepartments();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update department');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDepartment = async () => {
    if (!department) return;
    if (!confirm(`Delete "${department.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete department');
      await refreshDepartments();
      router.push('/departments');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department');
    }
  };

  const handleAddMember = async (userId: string) => {
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/departments/${id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to add member');
      const u = allUsers.find((x) => x.id === userId);
      if (u) {
        setMembers((prev) =>
          [...prev, { id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role }].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
        );
      }
      setAddQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/departments/${id}/members?user_id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to remove member');
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <DesktopSidebarShell>
      <div
        className="panel-form flex flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--task-surface-0)' }}
      >
        {/* Back to the list */}
        <div
          className="flex shrink-0 items-center border-b px-3 py-2"
          style={{ borderColor: 'var(--task-line-soft)' }}
        >
          <Link
            href="/departments"
            className="flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[length:var(--task-fs-chip)] transition-colors hover:bg-[var(--task-surface-1)] hover:text-[var(--task-ink-1)]"
            style={{ color: 'var(--task-ink-3)' }}
          >
            {ICONS.back}
            Departments
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className={DETAIL_COL}>
            {error && (
              <div
                className="mx-[18px] mt-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-[length:var(--task-fs-body-sm)]"
                style={{
                  borderColor: 'var(--task-amber)',
                  background: 'var(--task-amber-soft)',
                  color: 'var(--task-amber)',
                }}
              >
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0">
                  ✕
                </button>
              </div>
            )}

            {loading ? (
              <div className="px-[18px] py-12 text-center">
                <p
                  className="font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
                  style={{ color: 'var(--task-ink-3)' }}
                >
                  Loading department…
                </p>
              </div>
            ) : notFound ? (
              <div className="px-[18px] py-12 text-center">
                <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                  Department not found.
                </p>
                <div className="mt-4 flex justify-center">
                  <ChipButton set onClick={() => router.push('/departments')}>
                    Back to departments
                  </ChipButton>
                </div>
              </div>
            ) : department ? (
              <>
                {/* Department header — doubles as the edit surface. */}
                <div
                  className="flex items-center gap-2.5 border-b px-[18px] py-3"
                  style={{ borderColor: 'var(--task-line-soft)' }}
                >
                  {editing ? (
                    <>
                      <DeptIconPicker
                        open={iconPickerOpen}
                        onOpenChange={setIconPickerOpen}
                        value={editIcon}
                        onSelect={setEditIcon}
                      />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Department name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editName.trim()) handleSaveEdit();
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
                    </>
                  ) : (
                    <>
                      <span className="shrink-0">
                        <DeptGlyph iconKey={department.icon} size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[length:var(--task-fs-option)] font-medium"
                          style={{ color: 'var(--task-ink-1)' }}
                        >
                          {department.name}
                        </span>
                        <span
                          className="block truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
                          style={{ color: 'var(--task-ink-3)' }}
                        >
                          {members.length} member{members.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      {canManageMembers && (
                        <>
                          <ChipButton set={false} onClick={openEdit}>
                            Edit
                          </ChipButton>
                          <RowIconButton
                            danger
                            label="Delete department"
                            onClick={handleDeleteDepartment}
                          >
                            {ICONS.close}
                          </RowIconButton>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Members */}
                <div className="flex items-center justify-between gap-3 px-[18px] pb-1.5 pt-4">
                  <SectionLabel className="!px-0 !pb-0 !pt-0">Members</SectionLabel>
                  {canManageMembers && (
                    <AdaptivePicker
                      open={addOpen}
                      onOpenChange={(o) => {
                        setAddOpen(o);
                        if (!o) setAddQuery('');
                      }}
                      title="Add member"
                      align="end"
                      trigger={<ChipButton set>+ Add member</ChipButton>}
                    >
                      <div className="px-1 pb-1.5">
                        <div
                          className="flex h-[34px] items-center gap-2 rounded-lg px-2.5"
                          style={{ background: 'var(--task-surface-2)' }}
                        >
                          <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
                            {ICONS.search}
                          </span>
                          <input
                            autoFocus
                            value={addQuery}
                            onChange={(e) => setAddQuery(e.target.value)}
                            placeholder="Search people…"
                            className="min-w-0 flex-1 bg-transparent text-[length:var(--task-fs-body-sm)] outline-none placeholder:text-[var(--task-ink-3)]"
                            style={{ color: 'var(--task-ink-1)' }}
                          />
                        </div>
                      </div>
                      {addableUsers.length === 0 ? (
                        <p
                          className="px-3 py-6 text-center text-[length:var(--task-fs-body-sm)]"
                          style={{ color: 'var(--task-ink-3)' }}
                        >
                          {addQuery ? 'No matches.' : 'Everyone is already a member.'}
                        </p>
                      ) : (
                        addableUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            disabled={busyUserId === u.id}
                            onClick={() => handleAddMember(u.id)}
                            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--task-surface-2)] disabled:opacity-50"
                          >
                            <span
                              className={cn(
                                'h-2 w-2 shrink-0 rounded-full',
                                ROLE_COLORS[u.role || 'staff'] ?? 'bg-neutral-400',
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="block truncate text-[length:var(--task-fs-body-sm)]"
                                style={{ color: 'var(--task-ink-1)' }}
                              >
                                {u.name}
                              </span>
                              {u.email && (
                                <span
                                  className="block truncate font-mono text-[length:var(--task-fs-label)]"
                                  style={{ color: 'var(--task-ink-3)' }}
                                >
                                  {u.email}
                                </span>
                              )}
                            </span>
                          </button>
                        ))
                      )}
                    </AdaptivePicker>
                  )}
                </div>

                {members.length === 0 ? (
                  <div className="px-[18px] py-10 text-center">
                    <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                      No members yet.
                    </p>
                    {canManageMembers && (
                      <p
                        className="mt-1.5 text-[length:var(--task-fs-body-sm)]"
                        style={{ color: 'var(--task-ink-3)' }}
                      >
                        Add team members or vendors to this department.
                      </p>
                    )}
                  </div>
                ) : (
                  members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2.5 border-b px-[18px] py-2.5 transition-colors hover:bg-[var(--task-surface-1)]"
                      style={{ borderColor: 'var(--task-line-soft)' }}
                    >
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          ROLE_COLORS[m.role || 'staff'] ?? 'bg-neutral-400',
                        )}
                        title={m.role || 'staff'}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[length:var(--task-fs-option)]"
                          style={{ color: 'var(--task-ink-1)' }}
                        >
                          {m.name}
                        </span>
                        {m.email && (
                          <span
                            className="block truncate font-mono text-[length:var(--task-fs-label)]"
                            style={{ color: 'var(--task-ink-3)' }}
                          >
                            {m.email}
                          </span>
                        )}
                      </span>
                      <MetaChip>{m.role || 'staff'}</MetaChip>
                      {canManageMembers && (
                        <RowIconButton
                          danger
                          label={`Remove ${m.name}`}
                          onClick={() => {
                            if (busyUserId === m.id) return;
                            handleRemoveMember(m.id);
                          }}
                        >
                          {ICONS.close}
                        </RowIconButton>
                      )}
                    </div>
                  ))
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </DesktopSidebarShell>
  );
}
