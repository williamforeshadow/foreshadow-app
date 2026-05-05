'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectBin } from '@/lib/types';

interface BinPickerProps {
  bins: ProjectBin[];
  loadingBins: boolean;
  totalProjects: number;
  // Bin selection:
  //   null    → Task Bin (default destination; orphan binned tasks). The Task
  //             Bin kanban itself exposes a "Global" toggle that, when on,
  //             widens the view to every binned task across the Task Bin and
  //             every sub-bin — there is no separate "All Bins" tile.
  //   <uuid>  → a specific sub-bin
  onSelectBin: (binId: string | null) => void;
  onCreateBin: (name: string, description?: string) => Promise<ProjectBin | null>;
  onDeleteBin: (binId: string) => void;
  onUpdateBin: (
    binId: string,
    updates: Partial<Pick<ProjectBin, 'name' | 'description' | 'auto_dismiss_enabled' | 'auto_dismiss_days'>>
  ) => void | Promise<void>;
}

export function BinPicker({
  bins,
  loadingBins,
  totalProjects,
  onSelectBin,
  onCreateBin,
  onDeleteBin,
  onUpdateBin,
}: BinPickerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBinName, setNewBinName] = useState('');
  const [newBinDescription, setNewBinDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsBinId, setSettingsBinId] = useState<string | null>(null);
  const [settingsIsSystem, setSettingsIsSystem] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [settingsAutoEnabled, setSettingsAutoEnabled] = useState(false);
  const [settingsAutoDays, setSettingsAutoDays] = useState<number>(7);
  const [contextMenuBinId, setContextMenuBinId] = useState<string | null>(null);

  // The system bin is the "Task Bin" — the default destination for binned
  // tasks that haven't been assigned to a specific sub-bin. It owns the
  // auto-dismiss config for orphan binned tasks (bin_id IS NULL). User-
  // created bins are surfaced as sub-bins.
  const systemBin = useMemo(() => bins.find((b) => b.is_system) ?? null, [bins]);
  const subBins = useMemo(() => bins.filter((b) => !b.is_system), [bins]);

  // Orphan count = total binned − (tasks assigned to a sub-bin). The bins
  // API only fills `project_count` for sub-bins (orphans have no bin_id),
  // so we derive Task Bin's count from totals here.
  const taskBinCount = useMemo(
    () => Math.max(0, totalProjects - subBins.reduce((s, b) => s + (b.project_count || 0), 0)),
    [totalProjects, subBins]
  );

  const handleCreate = useCallback(async () => {
    if (!newBinName.trim()) return;
    setCreating(true);
    const bin = await onCreateBin(newBinName.trim(), newBinDescription.trim() || undefined);
    if (bin) {
      setNewBinName('');
      setNewBinDescription('');
      setShowCreateForm(false);
    }
    setCreating(false);
  }, [newBinName, newBinDescription, onCreateBin]);

  const openSettings = useCallback((bin: ProjectBin) => {
    setSettingsBinId(bin.id);
    setSettingsIsSystem(!!bin.is_system);
    setSettingsName(bin.name);
    setSettingsAutoEnabled(!!bin.auto_dismiss_enabled);
    setSettingsAutoDays(
      typeof bin.auto_dismiss_days === 'number' ? bin.auto_dismiss_days : 7
    );
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsBinId(null);
    setSettingsIsSystem(false);
  }, []);

  const handleSaveSettings = useCallback(async () => {
    if (!settingsBinId) return;
    const days = Math.max(0, Math.min(365, Math.round(Number(settingsAutoDays) || 0)));
    // System bins: only auto-dismiss config is editable.
    const updates: Partial<Pick<ProjectBin, 'name' | 'auto_dismiss_enabled' | 'auto_dismiss_days'>> = {
      auto_dismiss_enabled: settingsAutoEnabled,
      auto_dismiss_days: days,
    };
    if (!settingsIsSystem) {
      const trimmedName = settingsName.trim();
      if (!trimmedName) return;
      updates.name = trimmedName;
    }
    await onUpdateBin(settingsBinId, updates);
    setSettingsBinId(null);
    setSettingsIsSystem(false);
  }, [settingsBinId, settingsIsSystem, settingsName, settingsAutoEnabled, settingsAutoDays, onUpdateBin]);

  if (loadingBins) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-[#0b0b0c]">
        <p className="text-neutral-500 dark:text-white/50">Loading bins...</p>
      </div>
    );
  }

  return (
    // Explicit white page bg in light mode (matches Turnovers / Tasks). The
    // entire palette below is dual-mode — historically this surface was
    // dark-only (white text + white/0.0X surfaces), which rendered as
    // invisible white-on-grey content against `bg-background` in light mode.
    <div className="h-full flex flex-col bg-white dark:bg-[#0b0b0c]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-white/10 flex-shrink-0">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">Bins</h2>
          <p className="text-sm text-neutral-500 dark:text-white/40 mt-0.5">
            {totalProjects} binned task{totalProjects !== 1 ? 's' : ''} across the Task Bin and {subBins.length} sub-bin{subBins.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateForm(true)}
          className="bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border border-neutral-200 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] dark:text-white dark:border-white/10 dark:backdrop-blur-sm"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          New Sub-Bin
        </Button>
      </div>

      {/* Bin Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Task Bin Card — backed by the system bin row for its auto-dismiss config.
              Clicking opens the orphan-only view (binned tasks with no sub-bin). */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelectBin(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBin(null); } }}
            className={cn(
              'group relative flex flex-col justify-between p-5 rounded-xl border transition-all duration-200 text-left min-h-[140px] cursor-pointer',
              'border-neutral-200 bg-neutral-100 hover:bg-neutral-200/70 hover:border-neutral-300',
              'dark:border-white/10 dark:bg-white/[0.04] dark:backdrop-blur-md dark:hover:bg-white/[0.08] dark:hover:border-white/20',
              // Lift the card above the context-menu close overlay (z-10) so clicks
              // reach the dropdown. Without this, `backdrop-blur-md` creates a new
              // stacking context and the overlay ends up on top of the dropdown.
              systemBin && contextMenuBinId === systemBin.id && 'z-20'
            )}
          >
            {/* ⋯ menu button — visible on hover, only when we have a system bin row to configure */}
            {systemBin && (
              <div
                className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setContextMenuBinId(contextMenuBinId === systemBin.id ? null : systemBin.id)}
                  className="p-1 rounded-md hover:bg-neutral-300/50 dark:hover:bg-white/10 transition-colors"
                  title="Auto-dismiss options"
                >
                  <svg className="w-4 h-4 text-neutral-500 dark:text-white/40" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </button>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-500 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white">Task Bin</h3>
              </div>
              <p className="text-xs text-neutral-500 dark:text-white/30 line-clamp-2">
                Default destination for binned tasks. Use sub-bins to organize further.
              </p>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm font-medium text-neutral-500 dark:text-white/40">
                {taskBinCount} task{taskBinCount !== 1 ? 's' : ''}
              </span>
              <svg className="w-4 h-4 text-neutral-300 dark:text-white/20 group-hover:text-neutral-500 dark:group-hover:text-white/40 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>

            {/* Context menu dropdown — system bin only has Settings */}
            {systemBin && contextMenuBinId === systemBin.id && (
              <div
                className="absolute top-10 right-3 z-20 bg-white dark:bg-neutral-900/90 dark:backdrop-blur-xl border border-neutral-200 dark:border-white/10 rounded-lg shadow-lg dark:shadow-2xl py-1 min-w-[140px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-neutral-700 dark:text-white/70 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors"
                  onClick={() => {
                    openSettings(systemBin);
                    setContextMenuBinId(null);
                  }}
                >
                  Settings
                </button>
              </div>
            )}
          </div>

          {/* Individual Sub-Bin Cards */}
          {subBins.map((bin) => (
            <div
              key={bin.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectBin(bin.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBin(bin.id); } }}
              className={cn(
                'group relative flex flex-col justify-between p-5 rounded-xl border transition-all duration-200 text-left min-h-[140px] cursor-pointer',
                'border-neutral-200 bg-neutral-100 hover:bg-neutral-200/70 hover:border-neutral-300',
                'dark:border-white/10 dark:bg-white/[0.04] dark:backdrop-blur-md dark:hover:bg-white/[0.08] dark:hover:border-white/20',
                // Same fix as above: lift the card above the close overlay
                // while its context menu is open so the buttons are clickable.
                contextMenuBinId === bin.id && 'z-20'
              )}
            >
              {/* ⋯ menu button — visible on hover */}
              <div
                className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setContextMenuBinId(contextMenuBinId === bin.id ? null : bin.id)}
                  className="p-1 rounded-md hover:bg-neutral-300/50 dark:hover:bg-white/10 transition-colors"
                  title="Sub-bin options"
                >
                  <svg className="w-4 h-4 text-neutral-500 dark:text-white/40" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-white truncate">{bin.name}</h3>
                </div>
                {bin.description && (
                  <p className="text-xs text-neutral-500 dark:text-white/30 line-clamp-2">
                    {bin.description}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm font-medium text-neutral-500 dark:text-white/40">
                  {bin.project_count || 0} task{(bin.project_count || 0) !== 1 ? 's' : ''}
                </span>
                <svg className="w-4 h-4 text-neutral-300 dark:text-white/20 group-hover:text-neutral-500 dark:group-hover:text-white/40 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {/* Context menu dropdown */}
              {contextMenuBinId === bin.id && (
                <div
                  className="absolute top-10 right-3 z-20 bg-white dark:bg-neutral-900/90 dark:backdrop-blur-xl border border-neutral-200 dark:border-white/10 rounded-lg shadow-lg dark:shadow-2xl py-1 min-w-[140px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-neutral-700 dark:text-white/70 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors"
                    onClick={() => {
                      openSettings(bin);
                      setContextMenuBinId(null);
                    }}
                  >
                    Settings
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors"
                    onClick={() => {
                      if (confirm(`Delete sub-bin "${bin.name}"? Tasks will remain in the Task Bin.`)) {
                        onDeleteBin(bin.id);
                      }
                      setContextMenuBinId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Create New Sub-Bin Card */}
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex flex-col items-center justify-center p-5 rounded-xl border border-dashed border-neutral-300 dark:border-white/10 bg-transparent hover:bg-neutral-100 hover:border-neutral-400 dark:hover:bg-white/[0.04] dark:hover:border-white/20 transition-all duration-200 min-h-[140px]"
            >
              <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-white/[0.06] flex items-center justify-center mb-2">
                <svg className="w-5 h-5 text-neutral-400 dark:text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <span className="text-sm text-neutral-500 dark:text-white/30 font-medium">Create Sub-Bin</span>
            </button>
          )}
        </div>

        {/* Inline Create Form */}
        {showCreateForm && (
          <div className="mt-6 p-5 rounded-xl border border-neutral-200 bg-neutral-100 dark:border-white/10 dark:bg-white/[0.04] dark:backdrop-blur-md max-w-md">
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">New Sub-Bin</h4>
            <input
              autoFocus
              type="text"
              placeholder="Sub-bin name..."
              value={newBinName}
              onChange={(e) => setNewBinName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full px-3 py-2 rounded-lg bg-white border border-neutral-200 text-neutral-900 placeholder-neutral-400 dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder-white/30 text-sm outline-none focus:border-neutral-400 dark:focus:border-white/20 mb-2"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newBinDescription}
              onChange={(e) => setNewBinDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full px-3 py-2 rounded-lg bg-white border border-neutral-200 text-neutral-900 placeholder-neutral-400 dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder-white/30 text-sm outline-none focus:border-neutral-400 dark:focus:border-white/20 mb-3"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!newBinName.trim() || creating}
                onClick={handleCreate}
              >
                {creating ? 'Creating...' : 'Create'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-neutral-500 dark:text-white/40"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewBinName('');
                  setNewBinDescription('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Close context menu on click outside */}
      {contextMenuBinId && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setContextMenuBinId(null)}
        />
      )}

      {/* Settings modal */}
      {settingsBinId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
          onClick={closeSettings}
        >
          <div
            className="w-full max-w-md mx-4 p-6 rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-white/10 dark:bg-neutral-900/95 dark:backdrop-blur-xl dark:shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                {settingsIsSystem ? 'Task Bin Settings' : 'Sub-Bin Settings'}
              </h3>
              <button
                onClick={closeSettings}
                className="p-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-white/40 dark:hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Name — editable for user bins, locked for system bin */}
              {!settingsIsSystem ? (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-neutral-200 text-neutral-900 dark:bg-white/[0.06] dark:border-white/10 dark:text-white text-sm outline-none focus:border-neutral-400 dark:focus:border-white/20"
                  />
                </div>
              ) : (
                <p className="text-xs text-neutral-600 dark:text-white/50 leading-relaxed">
                  These settings apply to <strong className="text-neutral-900 dark:text-white/80">orphan binned tasks</strong> —
                  tasks binned without assigning them to a specific sub-bin. Each
                  sub-bin has its own auto-dismiss settings.
                </p>
              )}

              <div className={settingsIsSystem ? '' : 'pt-2 border-t border-neutral-200 dark:border-white/10'}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <p className="text-sm font-medium text-neutral-900 dark:text-white">Auto-dismiss completed tasks</p>
                    <p className="text-xs text-neutral-500 dark:text-white/40 mt-0.5">
                      Remove completed tasks from this bin after a set number of days.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settingsAutoEnabled}
                    onClick={() => setSettingsAutoEnabled((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      settingsAutoEnabled
                        ? 'bg-amber-500 dark:bg-amber-500/80'
                        : 'bg-neutral-200 dark:bg-white/10'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        settingsAutoEnabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {settingsAutoEnabled && (
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-neutral-500 dark:text-white/50">Dismiss after</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={settingsAutoDays}
                      onChange={(e) => setSettingsAutoDays(Number(e.target.value))}
                      className="w-20 px-2 py-1.5 rounded-lg bg-white border border-neutral-200 text-neutral-900 dark:bg-white/[0.06] dark:border-white/10 dark:text-white text-sm outline-none focus:border-neutral-400 dark:focus:border-white/20 text-center"
                    />
                    <span className="text-xs text-neutral-500 dark:text-white/50">
                      day{settingsAutoDays === 1 ? '' : 's'} of being completed
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-neutral-200 dark:border-white/10">
              <Button
                size="sm"
                variant="ghost"
                className="text-neutral-500 dark:text-white/60"
                onClick={closeSettings}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!settingsIsSystem && !settingsName.trim()}
                onClick={handleSaveSettings}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
