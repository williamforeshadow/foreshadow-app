'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Pencil, Trash2, Plus } from 'lucide-react';
import type { Department } from '@/lib/types';
import { getDepartmentIcon, DEPARTMENT_ICON_OPTIONS, DEPARTMENT_ICON_MAP } from '@/lib/departmentIcons';

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      if (res.ok && data.departments) {
        setDepartments(data.departments);
      } else {
        setError(data.error || 'Failed to fetch departments');
      }
    } catch (err) {
      setError('Failed to fetch departments');
    } finally {
      setLoading(false);
    }
  };

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
        setDepartments(prev => [...prev, data.department].sort((a, b) => a.name.localeCompare(b.name)));
        setShowCreateDialog(false);
        setNewName('');
        setNewIcon('folder');
      } else {
        setError(data.error || 'Failed to create department');
      }
    } catch (err) {
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
        setDepartments(prev =>
          prev.map(d => d.id === editingId ? data.department : d).sort((a, b) => a.name.localeCompare(b.name))
        );
        cancelEdit();
      } else {
        setError(data.error || 'Failed to update department');
      }
    } catch (err) {
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
        setDepartments(prev => prev.filter(d => d.id !== id));
        setDeletingId(null);
      } else {
        setDeleteError(data.error || 'Failed to delete department');
      }
    } catch (err) {
      setDeleteError('Failed to delete department');
    }
  };

  const IconPickerGrid = ({
    selectedIcon,
    onSelect,
    pickerId,
  }: {
    selectedIcon: string;
    onSelect: (key: string) => void;
    pickerId: string;
  }) => (
    <Popover open={iconPickerOpen === pickerId} onOpenChange={(open) => setIconPickerOpen(open ? pickerId : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors bg-white dark:bg-neutral-800"
          title="Choose icon"
        >
          {(() => {
            const IconComp = getDepartmentIcon(selectedIcon);
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
                  onSelect(opt.key);
                  setIconPickerOpen(null);
                }}
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-md transition-colors',
                  selectedIcon === opt.key
                    ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
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
  );

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Departments
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage departments for templates, tasks, and projects.
          </p>

          <div className="flex items-center justify-between mt-4">
            <Badge variant="secondary" className="text-xs">
              {departments.length} department{departments.length !== 1 ? 's' : ''}
            </Badge>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Department
            </Button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">✕</button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-neutral-500">
              Loading departments...
            </div>
          ) : departments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                No departments yet. Create your first department to organize templates and tasks.
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Department
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {departments.map((dept) => {
                const isEditing = editingId === dept.id;
                const IconComp = getDepartmentIcon(isEditing ? editIcon : dept.icon);

                return (
                  <Card
                    key={dept.id}
                    className={cn(
                      'group relative transition-all duration-150',
                      isEditing
                        ? 'ring-2 ring-neutral-400 dark:ring-neutral-500'
                        : 'hover:border-neutral-400 dark:hover:border-neutral-500'
                    )}
                  >
                    <CardContent className="p-4">
                      {isEditing ? (
                        /* Edit mode */
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <IconPickerGrid
                              selectedIcon={editIcon}
                              onSelect={setEditIcon}
                              pickerId="edit"
                            />
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Department name"
                              className="flex-1"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') cancelEdit();
                              }}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={handleSaveEdit}
                              disabled={saving || !editName.trim()}
                              className="flex-1"
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEdit}
                              className="flex-1"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* Display mode */
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex-shrink-0">
                            <IconComp className="w-5 h-5 text-neutral-700 dark:text-neutral-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-neutral-900 dark:text-white truncate">
                              {dept.name}
                            </p>
                          </div>
                          {/* Action buttons - show on hover */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(dept)}
                              className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                              title="Edit department"
                            >
                              <Pencil className="w-3.5 h-3.5 text-neutral-500" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete "${dept.name}"? This cannot be undone.`)) {
                                  handleDelete(dept.id);
                                }
                              }}
                              className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Delete department"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Delete error toast */}
        {deleteError && (
          <div className="fixed bottom-6 right-6 max-w-md p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg shadow-lg text-sm text-red-700 dark:text-red-300 z-50">
            <div className="flex items-start justify-between gap-3">
              <span>{deleteError}</span>
              <button onClick={() => { setDeleteError(null); setDeletingId(null); }} className="text-red-500 hover:text-red-700 flex-shrink-0">✕</button>
            </div>
          </div>
        )}
      </div>

      {/* Create Department Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Department</DialogTitle>
            <DialogDescription>
              Create a new department to organize templates, tasks, and projects.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <IconPickerGrid
                selectedIcon={newIcon}
                onSelect={setNewIcon}
                pickerId="create"
              />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Department name"
                className="flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) handleCreate();
                }}
              />
            </div>

            {/* Preview */}
            {newName.trim() && (
              <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
                {(() => {
                  const PreviewIcon = getDepartmentIcon(newIcon);
                  return (
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-white dark:bg-neutral-700">
                      <PreviewIcon className="w-4 h-4 text-neutral-700 dark:text-neutral-300" />
                    </div>
                  );
                })()}
                <span className="text-sm font-medium text-neutral-900 dark:text-white">{newName.trim()}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
