'use client';

import { useState, memo, useMemo } from 'react';
import type { ProjectBin } from '@/lib/types';

interface MobileBinPickerProps {
  bins: ProjectBin[];
  totalProjects: number;
  loadingBins: boolean;
  onSelectBin: (binId: string) => void;
  onSelectAll: () => void;
  onCreateBin: (name: string, description?: string) => Promise<ProjectBin | null>;
  onUpdateBin?: (
    binId: string,
    updates: Partial<Pick<ProjectBin, 'name' | 'description' | 'auto_dismiss_enabled' | 'auto_dismiss_days'>>
  ) => Promise<void> | void;
  onDeleteBin?: (binId: string) => Promise<void>;
}

const binCard =
  'w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98] ' +
  'bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] ' +
  'border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]';

const MobileBinPicker = memo(function MobileBinPicker({
  bins,
  totalProjects,
  loadingBins,
  onSelectBin,
  onSelectAll,
  onCreateBin,
  onUpdateBin,
  onDeleteBin,
}: MobileBinPickerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newBinName, setNewBinName] = useState('');
  const [newBinDesc, setNewBinDesc] = useState('');

  // Editing state
  const [editingBinId, setEditingBinId] = useState<string | null>(null);
  const [editingIsSystem, setEditingIsSystem] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAutoEnabled, setEditAutoEnabled] = useState(false);
  const [editAutoDays, setEditAutoDays] = useState<number>(7);

  // Menu state (which bin's "..." menu is open)
  const [menuBinId, setMenuBinId] = useState<string | null>(null);

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Split system bin (owner of orphan binned-task auto-dismiss config) from user bins.
  const systemBin = useMemo(() => bins.find((b) => b.is_system) ?? null, [bins]);
  const userBins = useMemo(() => bins.filter((b) => !b.is_system), [bins]);

  const handleCreate = async () => {
    if (!newBinName.trim()) return;
    await onCreateBin(newBinName.trim(), newBinDesc.trim() || undefined);
    setNewBinName('');
    setNewBinDesc('');
    setIsCreating(false);
  };

  const handleStartEdit = (bin: ProjectBin) => {
    setEditingBinId(bin.id);
    setEditingIsSystem(!!bin.is_system);
    setEditName(bin.name);
    setEditDesc(bin.description || '');
    setEditAutoEnabled(!!bin.auto_dismiss_enabled);
    setEditAutoDays(typeof bin.auto_dismiss_days === 'number' ? bin.auto_dismiss_days : 7);
    setMenuBinId(null);
  };

  const handleSaveEdit = async () => {
    if (!editingBinId || !onUpdateBin) return;
    const days = Math.max(0, Math.min(365, Math.round(Number(editAutoDays) || 0)));
    const updates: Partial<Pick<ProjectBin, 'name' | 'description' | 'auto_dismiss_enabled' | 'auto_dismiss_days'>> = {
      auto_dismiss_enabled: editAutoEnabled,
      auto_dismiss_days: days,
    };
    if (!editingIsSystem) {
      if (!editName.trim()) return;
      updates.name = editName.trim();
      updates.description = editDesc.trim() || null;
    }
    await onUpdateBin(editingBinId, updates);
    setEditingBinId(null);
    setEditingIsSystem(false);
  };

  const handleDelete = async (binId: string) => {
    if (!onDeleteBin) return;
    await onDeleteBin(binId);
    setConfirmDeleteId(null);
    setMenuBinId(null);
  };

  if (loadingBins) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // When the user taps "Edit" on the system bin, render the edit form in place
  // of the "All Binned Tasks" tile (same pattern as user bins).
  const systemIsEditing = !!systemBin && editingBinId === systemBin.id;
  const systemMenuOpen = !!systemBin && menuBinId === systemBin.id;

  return (
    <div className="px-[22px] pt-2 pb-4 flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight leading-none text-neutral-900 dark:text-[#f0efed]">Task Bins</h1>
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
            {totalProjects} binned task{totalProjects !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setIsCreating(!isCreating)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-500 dark:text-[#a09e9a] active:opacity-70 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Bin
          </button>
        </div>
      </div>

      {/* Create bin input */}
      {isCreating && (
        <div className="flex flex-col gap-2 p-4 rounded-xl bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
          <input
            type="text"
            value={newBinName}
            onChange={(e) => setNewBinName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Bin name..."
            autoFocus
            className="bg-transparent text-sm text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] outline-none"
          />
          <input
            type="text"
            value={newBinDesc}
            onChange={(e) => setNewBinDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Description (optional)"
            className="bg-transparent text-xs text-neutral-600 dark:text-[#a09e9a] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] outline-none"
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={!newBinName.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-800 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] disabled:opacity-40 active:opacity-80 transition-opacity"
            >
              Create
            </button>
            <button
              onClick={() => { setIsCreating(false); setNewBinName(''); setNewBinDesc(''); }}
              className="text-xs text-neutral-400 dark:text-[#66645f] px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* All Binned Tasks — render the inline edit form if system bin is being edited */}
      {systemIsEditing && systemBin ? (
        <div
          className="flex flex-col gap-2 p-4 rounded-xl bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]"
        >
          <p className="text-sm font-semibold text-neutral-900 dark:text-[#f0efed]">All Binned Tasks</p>
          <p className="text-[11px] text-neutral-500 dark:text-[#66645f] leading-snug">
            Auto-dismiss applies to orphan binned tasks (binned without an assigned bin).
          </p>

          {/* Auto-dismiss controls */}
          <div className="mt-2 pt-2 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-neutral-900 dark:text-[#f0efed]">Auto-dismiss completed</p>
                <p className="text-[11px] text-neutral-500 dark:text-[#66645f] leading-snug">
                  Remove completed tasks after N days.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={editAutoEnabled}
                onClick={() => setEditAutoEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  editAutoEnabled ? 'bg-amber-500' : 'bg-neutral-300 dark:bg-[rgba(255,255,255,0.12)]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    editAutoEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {editAutoEnabled && (
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-neutral-500 dark:text-[#66645f]">After</label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={editAutoDays}
                  onChange={(e) => setEditAutoDays(Number(e.target.value))}
                  className="w-16 px-2 py-1 rounded-md bg-white dark:bg-[rgba(255,255,255,0.04)] border border-neutral-200 dark:border-[rgba(255,255,255,0.1)] text-sm text-neutral-900 dark:text-[#f0efed] outline-none text-center"
                />
                <span className="text-[11px] text-neutral-500 dark:text-[#66645f]">
                  day{editAutoDays === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSaveEdit}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-800 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] active:opacity-80 transition-opacity"
            >
              Save
            </button>
            <button
              onClick={() => { setEditingBinId(null); setEditingIsSystem(false); }}
              className="text-xs text-neutral-400 px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <button onClick={onSelectAll} className={binCard}>
            <div className="w-11 h-11 rounded-xl bg-neutral-200/60 dark:bg-[rgba(255,255,255,0.04)] flex items-center justify-center">
              <svg className="w-5 h-5 text-neutral-500 dark:text-[#a09e9a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-neutral-900 dark:text-[#f0efed]">All Binned Tasks</p>
              <p className="text-xs text-neutral-500 dark:text-[#66645f] mt-0.5">{totalProjects} task{totalProjects !== 1 ? 's' : ''}</p>
            </div>
          </button>

          {/* "..." menu trigger — only when we have a system bin row and onUpdateBin */}
          {systemBin && onUpdateBin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuBinId(systemMenuOpen ? null : systemBin.id);
                setConfirmDeleteId(null);
              }}
              className="absolute top-2 right-2 p-1.5 rounded-lg text-neutral-400 dark:text-[#66645f] hover:text-neutral-600 dark:hover:text-[#a09e9a] transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
          )}

          {/* Dropdown menu for system bin — only Edit (no Delete) */}
          {systemMenuOpen && systemBin && (
            <>
              <div className="fixed inset-0 z-[39]" onClick={() => setMenuBinId(null)} />
              <div className="absolute top-10 right-2 z-40 min-w-[140px] py-1 rounded-xl bg-white dark:bg-[#1a1a1d] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl">
                <button
                  onClick={(e) => { e.stopPropagation(); handleStartEdit(systemBin); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bin List */}
      {userBins.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.08em] px-1 pt-2">
            Bins
          </p>
          {userBins.map((bin) => {
            const isEditing = editingBinId === bin.id;
            const isMenuOpen = menuBinId === bin.id;
            const isConfirmingDelete = confirmDeleteId === bin.id;

            if (isEditing) {
              return (
                <div
                  key={bin.id}
                  className="flex flex-col gap-2 p-4 rounded-xl bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]"
                >
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                    autoFocus
                    className="bg-transparent text-sm font-semibold text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] outline-none"
                  />
                  <input
                    type="text"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                    placeholder="Add a description..."
                    className="bg-transparent text-xs text-neutral-500 dark:text-[#a09e9a] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] outline-none"
                  />

                  {/* Auto-dismiss controls */}
                  <div className="mt-2 pt-2 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-neutral-900 dark:text-[#f0efed]">Auto-dismiss completed</p>
                        <p className="text-[11px] text-neutral-500 dark:text-[#66645f] leading-snug">
                          Remove completed tasks after N days.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editAutoEnabled}
                        onClick={() => setEditAutoEnabled((v) => !v)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                          editAutoEnabled ? 'bg-amber-500' : 'bg-neutral-300 dark:bg-[rgba(255,255,255,0.12)]'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                            editAutoEnabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                    {editAutoEnabled && (
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-neutral-500 dark:text-[#66645f]">After</label>
                        <input
                          type="number"
                          min={0}
                          max={365}
                          value={editAutoDays}
                          onChange={(e) => setEditAutoDays(Number(e.target.value))}
                          className="w-16 px-2 py-1 rounded-md bg-white dark:bg-[rgba(255,255,255,0.04)] border border-neutral-200 dark:border-[rgba(255,255,255,0.1)] text-sm text-neutral-900 dark:text-[#f0efed] outline-none text-center"
                        />
                        <span className="text-[11px] text-neutral-500 dark:text-[#66645f]">
                          day{editAutoDays === 1 ? '' : 's'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editName.trim()}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-800 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] disabled:opacity-40 active:opacity-80 transition-opacity"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingBinId(null)}
                      className="text-xs text-neutral-400 px-2 py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={bin.id} className="relative">
                <button
                  onClick={() => onSelectBin(bin.id)}
                  className={binCard}
                >
                  <div className="w-11 h-11 rounded-xl bg-neutral-200/60 dark:bg-[rgba(255,255,255,0.04)] flex items-center justify-center">
                    <svg className="w-5 h-5 text-neutral-500 dark:text-[#a09e9a]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-[#f0efed]">{bin.name}</p>
                    {bin.description && (
                      <p className="text-xs text-neutral-500 dark:text-[#66645f] mt-0.5 line-clamp-1">{bin.description}</p>
                    )}
                    <p className="text-[11px] text-neutral-400 dark:text-[#66645f] mt-0.5">
                      {bin.project_count ?? 0} task{(bin.project_count ?? 0) !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>

                {/* "..." menu trigger */}
                {(onUpdateBin || onDeleteBin) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuBinId(isMenuOpen ? null : bin.id);
                      setConfirmDeleteId(null);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg text-neutral-400 dark:text-[#66645f] hover:text-neutral-600 dark:hover:text-[#a09e9a] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>
                )}

                {/* Dropdown menu */}
                {isMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-[39]" onClick={() => { setMenuBinId(null); setConfirmDeleteId(null); }} />
                    <div className="absolute top-10 right-2 z-40 min-w-[140px] py-1 rounded-xl bg-white dark:bg-[#1a1a1d] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl">
                      {onUpdateBin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStartEdit(bin); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                      )}
                      {onDeleteBin && !isConfirmingDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(bin.id); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      )}
                      {isConfirmingDelete && (
                        <div className="px-3 py-2 flex flex-col gap-1.5">
                          <p className="text-xs text-red-500 font-medium">Delete this bin?</p>
                          <p className="text-[11px] text-neutral-500">Tasks will remain in All Binned Tasks.</p>
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(bin.id); }}
                              className="text-xs font-medium px-2.5 py-1 rounded-md bg-red-500 text-white active:bg-red-600 transition-colors"
                            >
                              Delete
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                              className="text-xs text-neutral-400 px-2 py-1"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default MobileBinPicker;
