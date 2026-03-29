'use client';

import { useState, memo } from 'react';
import type { ProjectBin } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

interface MobileBinPickerProps {
  bins: ProjectBin[];
  totalProjects: number;
  unbinnedCount: number;
  loadingBins: boolean;
  onSelectBin: (binId: string) => void;
  onSelectAll: () => void;
  onSelectUnbinned: () => void;
  onCreateBin: (name: string) => Promise<ProjectBin | null>;
}

// ============================================================================
// Component
// ============================================================================

const MobileBinPicker = memo(function MobileBinPicker({
  bins,
  totalProjects,
  unbinnedCount,
  loadingBins,
  onSelectBin,
  onSelectAll,
  onSelectUnbinned,
  onCreateBin,
}: MobileBinPickerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newBinName, setNewBinName] = useState('');

  const handleCreate = async () => {
    if (!newBinName.trim()) return;
    await onCreateBin(newBinName.trim());
    setNewBinName('');
    setIsCreating(false);
  };

  if (loadingBins) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">Projects</h2>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Bin
        </button>
      </div>

      {/* Create bin input */}
      {isCreating && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
          <input
            type="text"
            value={newBinName}
            onChange={(e) => setNewBinName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Bin name..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={!newBinName.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500 text-white disabled:opacity-40 active:bg-emerald-600 transition-colors"
          >
            Create
          </button>
          <button
            onClick={() => { setIsCreating(false); setNewBinName(''); }}
            className="text-xs text-neutral-400 px-2 py-1.5"
          >
            Cancel
          </button>
        </div>
      )}

      {/* All Projects Card */}
      <button
        onClick={onSelectAll}
        className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:scale-[0.98] transition-all text-left shadow-sm"
      >
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-sm">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">All Projects</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{totalProjects} project{totalProjects !== 1 ? 's' : ''}</p>
        </div>
        <svg className="w-5 h-5 text-neutral-300 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Unbinned Card */}
      {unbinnedCount > 0 && (
        <button
          onClick={onSelectUnbinned}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:scale-[0.98] transition-all text-left shadow-sm"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-neutral-300 to-neutral-400 dark:from-neutral-600 dark:to-neutral-700 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">Unbinned</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{unbinnedCount} project{unbinnedCount !== 1 ? 's' : ''}</p>
          </div>
          <svg className="w-5 h-5 text-neutral-300 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Bin List */}
      {bins.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider px-1 pt-2">
            Bins
          </p>
          {bins.map((bin) => (
            <button
              key={bin.id}
              onClick={() => onSelectBin(bin.id)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:scale-[0.98] transition-all text-left shadow-sm"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-sm">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">{bin.name}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {bin.project_count ?? 0} project{(bin.project_count ?? 0) !== 1 ? 's' : ''}
                </p>
              </div>
              <svg className="w-5 h-5 text-neutral-300 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MobileBinPicker;
