'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import type { ProjectBin } from '@/lib/types';

interface BinPickerProps {
  bins: ProjectBin[];
  loadingBins: boolean;
  totalProjects: number;
  unbinnedCount: number;
  onSelectBin: (binId: string | null) => void; // null = "All Projects"
  onCreateBin: (name: string, description?: string) => Promise<ProjectBin | null>;
  onDeleteBin: (binId: string) => void;
  onRenameBin: (binId: string, name: string) => void;
}

export function BinPicker({
  bins,
  loadingBins,
  totalProjects,
  unbinnedCount,
  onSelectBin,
  onCreateBin,
  onDeleteBin,
  onRenameBin,
}: BinPickerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBinName, setNewBinName] = useState('');
  const [newBinDescription, setNewBinDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingBinId, setEditingBinId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [contextMenuBinId, setContextMenuBinId] = useState<string | null>(null);

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

  const handleRename = useCallback((binId: string) => {
    if (editName.trim()) {
      onRenameBin(binId, editName.trim());
    }
    setEditingBinId(null);
    setEditName('');
  }, [editName, onRenameBin]);

  if (loadingBins) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-neutral-500">Loading bins...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 flex-shrink-0">
        <div>
          <h2 className="text-xl font-semibold text-white">Project Bins</h2>
          <p className="text-sm text-neutral-400 mt-0.5">
            {totalProjects} total project{totalProjects !== 1 ? 's' : ''} across {bins.length} bin{bins.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateForm(true)}
          className="bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700"
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
          {/* All Projects Card */}
          <button
            onClick={() => onSelectBin(null)}
            className="group relative flex flex-col justify-between p-5 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all duration-150 text-left min-h-[140px]"
          >
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-white">All Projects</h3>
              </div>
              <p className="text-xs text-neutral-500 line-clamp-2">
                View every project across all bins
              </p>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm font-medium text-neutral-400">
                {totalProjects} project{totalProjects !== 1 ? 's' : ''}
              </span>
              <svg className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Individual Bin Cards */}
          {bins.map((bin) => (
            <button
              key={bin.id}
              onClick={() => {
                if (editingBinId === bin.id) return;
                onSelectBin(bin.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenuBinId(contextMenuBinId === bin.id ? null : bin.id);
              }}
              className="group relative flex flex-col justify-between p-5 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all duration-150 text-left min-h-[140px]"
            >
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </div>
                  {editingBinId === bin.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleRename(bin.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(bin.id);
                        if (e.key === 'Escape') { setEditingBinId(null); setEditName(''); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-base font-semibold text-white bg-transparent border-b border-neutral-500 outline-none flex-1 min-w-0"
                    />
                  ) : (
                    <h3 className="text-base font-semibold text-white truncate">{bin.name}</h3>
                  )}
                </div>
                {bin.description && (
                  <p className="text-xs text-neutral-500 line-clamp-2">
                    {bin.description}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm font-medium text-neutral-400">
                  {bin.project_count || 0} project{(bin.project_count || 0) !== 1 ? 's' : ''}
                </span>
                <svg className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {/* Context menu */}
              {contextMenuBinId === bin.id && (
                <div
                  className="absolute top-2 right-2 z-20 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg py-1 min-w-[120px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors"
                    onClick={() => {
                      setEditingBinId(bin.id);
                      setEditName(bin.name);
                      setContextMenuBinId(null);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700 transition-colors"
                    onClick={() => {
                      if (confirm(`Delete "${bin.name}"? Projects will be moved to unbinned.`)) {
                        onDeleteBin(bin.id);
                      }
                      setContextMenuBinId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </button>
          ))}

          {/* Unbinned Card (only show if there are unbinned projects) */}
          {unbinnedCount > 0 && (
            <button
              onClick={() => onSelectBin('__none__')}
              className="group relative flex flex-col justify-between p-5 rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 hover:bg-neutral-800 hover:border-neutral-600 transition-all duration-150 text-left min-h-[140px]"
            >
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-neutral-700/50 flex items-center justify-center">
                    <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-neutral-400">Unbinned</h3>
                </div>
                <p className="text-xs text-neutral-600 line-clamp-2">
                  Projects not assigned to any bin
                </p>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm font-medium text-neutral-500">
                  {unbinnedCount} project{unbinnedCount !== 1 ? 's' : ''}
                </span>
                <svg className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          )}

          {/* Create New Bin Card */}
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex flex-col items-center justify-center p-5 rounded-xl border border-dashed border-neutral-700 bg-transparent hover:bg-neutral-900 hover:border-neutral-600 transition-all duration-150 min-h-[140px]"
            >
              <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center mb-2">
                <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <span className="text-sm text-neutral-500 font-medium">Create Bin</span>
            </button>
          )}
        </div>

        {/* Inline Create Form */}
        {showCreateForm && (
          <div className="mt-6 p-5 rounded-xl border border-neutral-700 bg-neutral-900 max-w-md">
            <h4 className="text-sm font-semibold text-white mb-3">New Bin</h4>
            <input
              autoFocus
              type="text"
              placeholder="Bin name..."
              value={newBinName}
              onChange={(e) => setNewBinName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder-neutral-500 outline-none focus:border-neutral-500 mb-2"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newBinDescription}
              onChange={(e) => setNewBinDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder-neutral-500 outline-none focus:border-neutral-500 mb-3"
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
                className="text-neutral-400"
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
    </div>
  );
}
