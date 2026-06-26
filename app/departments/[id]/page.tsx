'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getDepartmentIcon, DEPARTMENT_ICON_OPTIONS, DEPARTMENT_ICON_MAP } from '@/lib/departmentIcons';
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

  // Edit dialog state
  const [showEdit, setShowEdit] = useState(false);
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
    setShowEdit(true);
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
      setShowEdit(false);
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

  const HeaderIcon = getDepartmentIcon(department?.icon ?? 'folder');

  return (
    <DesktopSidebarShell>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sub-header: back link */}
        <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 py-4">
          <Link
            href="/departments"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All departments
          </Link>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">✕</button>
          </div>
        )}

        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-neutral-500">Loading department…</div>
          ) : notFound ? (
            <div className="text-center py-12">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">Department not found.</p>
              <Button onClick={() => router.push('/departments')}>Back to departments</Button>
            </div>
          ) : department ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
              {/* Department header */}
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex-shrink-0">
                  <HeaderIcon className="w-6 h-6 text-neutral-700 dark:text-neutral-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-white truncate">
                    {department.name}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {members.length} member{members.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {canManageMembers && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={openEdit}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteDepartment}
                      className="text-red-600 hover:text-red-700 dark:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>

              {/* Members */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Members</h2>
                  {canManageMembers && (
                    <AddMemberPicker
                      open={addOpen}
                      onOpenChange={(o) => {
                        setAddOpen(o);
                        if (!o) setAddQuery('');
                      }}
                      query={addQuery}
                      onQueryChange={setAddQuery}
                      users={addableUsers}
                      busyUserId={busyUserId}
                      onAdd={handleAddMember}
                    />
                  )}
                </div>

                {members.length === 0 ? (
                  <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      No members yet.
                      {canManageMembers ? ' Add team members or vendors to this department.' : ''}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      {members.map((m, idx) => (
                        <div
                          key={m.id}
                          className={cn(
                            'flex items-center gap-3 px-4 py-3',
                            idx !== members.length - 1 && 'border-b border-neutral-100 dark:border-neutral-800',
                          )}
                        >
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full flex-shrink-0',
                              ROLE_COLORS[m.role || 'staff'] ?? 'bg-neutral-400',
                            )}
                            title={m.role || 'staff'}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                              {m.name}
                            </p>
                            {m.email && (
                              <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                            )}
                          </div>
                          <span className="text-xs capitalize text-muted-foreground">{m.role || 'staff'}</span>
                          {canManageMembers && (
                            <button
                              type="button"
                              disabled={busyUserId === m.id}
                              onClick={() => handleRemoveMember(m.id)}
                              className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                              title={`Remove ${m.name}`}
                            >
                              <X className="w-4 h-4 text-neutral-400 hover:text-red-500" />
                            </button>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>

      {/* Edit Department Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription>Update the department name and icon.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors bg-white dark:bg-neutral-800"
                    title="Choose icon"
                  >
                    {(() => {
                      const IconComp = getDepartmentIcon(editIcon);
                      return <IconComp className="w-5 h-5 text-neutral-700 dark:text-neutral-300" />;
                    })()}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-3" align="start">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Choose an icon</p>
                  <div className="grid grid-cols-7 gap-1">
                    {DEPARTMENT_ICON_OPTIONS.map((opt) => {
                      const IconComp = DEPARTMENT_ICON_MAP[opt.key];
                      if (!IconComp) return null;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => {
                            setEditIcon(opt.key);
                            setIconPickerOpen(false);
                          }}
                          className={cn(
                            'flex items-center justify-center w-9 h-9 rounded-md transition-colors',
                            editIcon === opt.key
                              ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                              : 'hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400',
                          )}
                          title={opt.label}
                        >
                          <IconComp className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Department name"
                className="flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editName.trim()) handleSaveEdit();
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editName.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DesktopSidebarShell>
  );
}

// Add-member popover: search the (non-member) users and click one to add it.
function AddMemberPicker({
  open,
  onOpenChange,
  query,
  onQueryChange,
  users,
  busyUserId,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  users: { id: string; name: string; email?: string; role?: string }[];
  busyUserId: string | null;
  onAdd: (userId: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Add member
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-0 overflow-hidden"
        collisionPadding={12}
      >
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search people…"
            className="h-9"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {users.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query ? 'No matches.' : 'Everyone is already a member.'}
            </p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={busyUserId === u.id}
                onClick={() => onAdd(u.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                <span
                  className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    ROLE_COLORS[u.role || 'staff'] ?? 'bg-neutral-400',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{u.name}</span>
                  {u.email && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
                </span>
                {busyUserId === u.id ? (
                  <span className="text-xs text-muted-foreground">…</span>
                ) : (
                  <Check className="w-4 h-4 opacity-0" />
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
