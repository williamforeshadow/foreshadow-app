'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectBin } from '@/lib/types';

interface BinPickerProps {
  bins: ProjectBin[];
  loadingBins: boolean;
  totalProjects: number;
  onSelectBin: (binId: string | null) => void; // null = "All Binned Tasks"
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

  // Split system bin (the "All Binned Tasks" container that owns orphan tasks)
  // from the regular user-managed bins.
  const systemBin = useMemo(() => bins.find((b) => b.is_system) ?? null, [bins]);
  const userBins = useMemo(() => bins.filter((b) => !b.is_system), [bins]);

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
      <div className="flex items-center justify-center h-full">
        <p className="text-neutral-500">Loading bins...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div>
          <h2 className="text-xl font-semibold text-white">Task Bins</h2>
          <p className="text-sm text-white/40 mt-0.5">
            {totalProjects} binned task{totalProjects !== 1 ? 's' : ''} across {userBins.length} bin{userBins.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateForm(true)}
          className="bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10 backdrop-blur-sm"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          New Bin
        </Button>
      </div>

      {/* Bin Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* All Binned Tasks Card — backed by the system bin row for its auto-dismiss config */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelectBin(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBin(null); } }}
            className={cn(
              'group relative flex flex-col justify-between p-5 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200 text-left min-h-[140px] cursor-pointer',
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
                  className="p-1 rounded-md hover:bg-white/10 transition-colors"
                  title="Auto-dismiss options"
                >
                  <svg className="w-4 h-4 text-white/40" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </button>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-white">All Binned Tasks</h3>
              </div>
              <p className="text-xs text-white/30 line-clamp-2">
                View every task across all bins
              </p>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm font-medium text-white/40">
                {totalProjects} task{totalProjects !== 1 ? 's' : ''}
              </span>
              <svg className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>

            {/* Context menu dropdown — system bin only has Settings */}
            {systemBin && contextMenuBinId === systemBin.id && (
              <div
                className="absolute top-10 right-3 z-20 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl py-1 min-w-[140px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition-colors"
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

          {/* Individual Bin Cards */}
          {userBins.map((bin) => (
            <div
              key={bin.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectBin(bin.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBin(bin.id); } }}
              className={cn(
                'group relative flex flex-col justify-between p-5 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200 text-left min-h-[140px] cursor-pointer',
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
                  className="p-1 rounded-md hover:bg-white/10 transition-colors"
                  title="Bin options"
                >
                  <svg className="w-4 h-4 text-white/40" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-white truncate">{bin.name}</h3>
                </div>
                {bin.description && (
                  <p className="text-xs text-white/30 line-clamp-2">
                    {bin.description}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm font-medium text-white/40">
                  {bin.project_count || 0} task{(bin.project_count || 0) !== 1 ? 's' : ''}
                </span>
                <svg className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {/* Context menu dropdown */}
              {contextMenuBinId === bin.id && (
                <div
                  className="absolute top-10 right-3 z-20 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl py-1 min-w-[140px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition-colors"
                    onClick={() => {
                      openSettings(bin);
                      setContextMenuBinId(null);
                    }}
                  >
                    Settings
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/10 transition-colors"
                    onClick={() => {
                      if (confirm(`Delete "${bin.name}"? Tasks will remain in All Binned Tasks.`)) {
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

          {/* Create New Bin Card */}
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex flex-col items-center justify-center p-5 rounded-xl border border-dashed border-white/10 bg-transparent hover:bg-white/[0.04] hover:border-white/20 transition-all duration-200 min-h-[140px]"
            >
              <div className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center mb-2">
                <svg className="w-5 h-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <span className="text-sm text-white/30 font-medium">Create Bin</span>
            </button>
          )}
        </div>

        {/* Inline Create Form */}
        {showCreateForm && (
          <div className="mt-6 p-5 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md max-w-md">
            <h4 className="text-sm font-semibold text-white mb-3">New Bin</h4>
            <input
              autoFocus
              type="text"
              placeholder="Bin name..."
              value={newBinName}
              onChange={(e) => setNewBinName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-white/20 mb-2"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newBinDescription}
              onChange={(e) => setNewBinDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-white/20 mb-3"
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
                className="text-white/40"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeSettings}
        >
          <div
            className="w-full max-w-md mx-4 p-6 rounded-2xl border border-white/10 bg-neutral-900/95 backdrop-blur-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-white">
                {settingsIsSystem ? 'All Binned Tasks Settings' : 'Bin Settings'}
              </h3>
              <button
                onClick={closeSettings}
                className="p-1 rounded-md hover:bg-white/10 transition-colors text-white/40"
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
                  <label className="block text-[11px] font-medium text-white/50 uppercase tracking-wide mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm outline-none focus:border-white/20"
                  />
                </div>
              ) : (
                <p className="text-xs text-white/50 leading-relaxed">
                  Auto-dismiss settings here apply to <strong className="text-white/80">orphan binned tasks</strong> —
                  tasks you've binned without assigning them to a specific bin. Named
                  bins have their own auto-dismiss settings.
                </p>
              )}

              <div className={settingsIsSystem ? '' : 'pt-2 border-t border-white/10'}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <p className="text-sm font-medium text-white">Auto-dismiss completed tasks</p>
                    <p className="text-xs text-white/40 mt-0.5">
                      Remove completed tasks from this bin after a set number of days.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settingsAutoEnabled}
                    onClick={() => setSettingsAutoEnabled((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      settingsAutoEnabled ? 'bg-amber-500/80' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        settingsAutoEnabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {settingsAutoEnabled && (
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-white/50">Dismiss after</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={settingsAutoDays}
                      onChange={(e) => setSettingsAutoDays(Number(e.target.value))}
                      className="w-20 px-2 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm outline-none focus:border-white/20 text-center"
                    />
                    <span className="text-xs text-white/50">
                      day{settingsAutoDays === 1 ? '' : 's'} of being completed
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-white/10">
              <Button
                size="sm"
                variant="ghost"
                className="text-white/60"
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
