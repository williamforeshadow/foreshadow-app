'use client';

import { useState, useCallback, useEffect } from 'react';
import MobileBinPicker from '@/components/mobile/MobileBinPicker';
import MobileProjectsList from '@/components/mobile/MobileProjectsList';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useAuth } from '@/lib/authContext';
import type { Project, User, ProjectFormFields } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

/**
 * The projects view orchestrates three screens:
 *  1. BinPicker  — choose a workspace / "All" / "Unbinned"
 *  2. ProjectsList — see projects grouped by status inside that bin
 *  3. ProjectDetail — full-screen project editor
 */

type Screen =
  | { type: 'bins' }
  | { type: 'list'; binId: string | null; binName: string }
  | { type: 'detail'; project: Project; binId: string | null; binName: string };

interface MobileProjectsViewProps {
  users: User[];
  projectsHook: {
    projects: Project[];
    loadingProjects: boolean;
    fetchProjectsForBin: (binId: string | null) => Promise<void>;
    openCreateProjectDialog: (propertyName?: string, binId?: string) => void;
    saveProjectById: (projectId: string, fields: ProjectFormFields) => Promise<Project | null>;
    deleteProject: (project: Project) => void;
    recordProjectView: (projectId: string) => void;
  };
}

// ============================================================================
// Component
// ============================================================================

export default function MobileProjectsView({ users, projectsHook }: MobileProjectsViewProps) {
  const { user: currentUser } = useAuth();
  const binsHook = useProjectBins({ currentUser: currentUser as User | null });

  const [screen, setScreen] = useState<Screen>({ type: 'bins' });

  // When navigating to a bin list, fetch projects for that bin
  const navigateToBin = useCallback(async (binId: string | null, binName: string) => {
    setScreen({ type: 'list', binId, binName });
    await projectsHook.fetchProjectsForBin(binId);
  }, [projectsHook]);

  // Navigate to project detail
  const navigateToProject = useCallback((project: Project, binId: string | null, binName: string) => {
    projectsHook.recordProjectView(project.id);
    setScreen({ type: 'detail', project, binId, binName });
  }, [projectsHook]);

  // Back navigation
  const goBack = useCallback(() => {
    if (screen.type === 'detail') {
      setScreen({ type: 'list', binId: screen.binId, binName: screen.binName });
      // Refresh projects after potential edits
      projectsHook.fetchProjectsForBin(screen.binId);
    } else if (screen.type === 'list') {
      setScreen({ type: 'bins' });
      binsHook.fetchBins();
    }
  }, [screen, projectsHook, binsHook]);

  return (
    <div className="h-full">
      {/* Bins screen */}
      {screen.type === 'bins' && (
        <MobileBinPicker
          bins={binsHook.bins}
          totalProjects={binsHook.totalProjects}
          unbinnedCount={binsHook.unbinnedCount}
          loadingBins={binsHook.loadingBins}
          onSelectBin={(binId) => {
            const bin = binsHook.bins.find(b => b.id === binId);
            navigateToBin(binId, bin?.name || 'Bin');
          }}
          onSelectAll={() => navigateToBin(null, 'All Projects')}
          onSelectUnbinned={() => navigateToBin('__none__', 'Unbinned')}
          onCreateBin={binsHook.createBin}
        />
      )}

      {/* Projects list screen */}
      {screen.type === 'list' && (
        <MobileProjectsList
          projects={projectsHook.projects}
          users={users}
          binName={screen.binName}
          viewMode="status"
          onBack={goBack}
          onSelectProject={(project) => navigateToProject(project, screen.binId, screen.binName)}
          onCreateProject={() => {
            const effectiveBinId = screen.binId && screen.binId !== '__none__' ? screen.binId : undefined;
            projectsHook.openCreateProjectDialog(undefined, effectiveBinId);
          }}
        />
      )}

      {/* Project detail screen */}
      {screen.type === 'detail' && (
        <MobileProjectDetail
          project={screen.project}
          users={users}
          onClose={goBack}
          onSave={projectsHook.saveProjectById}
          onDelete={(project) => {
            projectsHook.deleteProject(project);
            setScreen({ type: 'list', binId: screen.binId, binName: screen.binName });
          }}
        />
      )}
    </div>
  );
}
