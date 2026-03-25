'use client';

import { memo, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { useProjects } from '@/lib/useProjects';
import { STATUS_LABELS, STATUS_ORDER, PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/useProjects';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import {
  ProjectDetailPanel,
  ProjectActivitySheet,
  AttachmentLightbox,
  BinPicker,
} from './projects';
import { ColumnPicker } from './projects/ColumnPicker';
import { ProjectsKanban } from './projects/ProjectsKanban';
import type { User, Project, Attachment, Comment, ProjectFormFields } from '@/lib/types';

interface ProjectsWindowProps {
  users: User[];
  currentUser: User | null;
  projectsHook: ReturnType<typeof useProjects>;
}

function ProjectsWindowContent({ users, currentUser, projectsHook }: ProjectsWindowProps) {
  // ============================================================================
  // Bins hook
  // ============================================================================
  const binsHook = useProjectBins({ currentUser });

  // Which bin is currently selected? null = still on picker screen
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [selectedBinName, setSelectedBinName] = useState<string>('All Projects');
  const [showKanban, setShowKanban] = useState(false);

  // ============================================================================
  // LOCAL instances of sub-hooks (independent from TurnoversWindow)
  // ============================================================================
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const activityHook = useProjectActivity();

  // ============================================================================
  // LOCAL UI State (independent from other windows)
  // ============================================================================
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [editingProjectFields, setEditingProjectFields] = useState<ProjectFormFields | null>(null);
  const [newComment, setNewComment] = useState('');
  const [staffOpen, setStaffOpen] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);

  // Ref to track the latest editing fields (avoids stale closure issues)
  const editingFieldsRef = useRef<ProjectFormFields | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    editingFieldsRef.current = editingProjectFields;
  }, [editingProjectFields]);

  // ============================================================================
  // SHARED data from projectsHook (only core project data and mutations)
  // ============================================================================
  const {
    // Core data
    projects,
    loadingProjects,
    allProperties,
    
    // View mode
    viewMode,
    setViewMode,

    // Bin filtering
    activeBinId,
    fetchProjectsForBin,

    // Project views
    recordProjectView,
    getUnreadCommentCount,

    // Project creation (dialog-less)
    createProjectForProperty,
    deleteProject,

    // Saving state
    savingProjectEdit,
    saveProjectById,
    updateProjectField,
  } = projectsHook;

  // ============================================================================
  // Column Visibility (picker for which columns to show on the Kanban)
  // ============================================================================
  const columnVis = useColumnVisibility(selectedBinId, viewMode);

  // Compute all possible column options for the picker
  const allColumnOptions = useMemo(() => {
    if (viewMode === 'property') {
      const names = new Set<string>();
      names.add('No Property'); // Always available as first option
      projects.forEach((p) => names.add(p.property_name || 'No Property'));
      allProperties.forEach((p) => { if (p.name) names.add(p.name); });
      const sorted = Array.from(names).sort((a, b) => {
        if (a === 'No Property') return -1;
        if (b === 'No Property') return 1;
        return a.localeCompare(b);
      });
      return sorted.map((name) => ({ id: `prop:${name}`, name }));
    }
    if (viewMode === 'status') {
      return STATUS_ORDER.map((s) => ({ id: `status:${s}`, name: STATUS_LABELS[s] }));
    }
    return PRIORITY_ORDER.map((p) => ({ id: `priority:${p}`, name: PRIORITY_LABELS[p] }));
  }, [viewMode, projects, allProperties]);

  // Initialize column visibility defaults when columns are known
  useEffect(() => {
    if (allColumnOptions.length > 0 && columnVis.initialized) {
      columnVis.initWithDefaults(allColumnOptions.map((c) => c.id));
    }
  }, [allColumnOptions, columnVis.initialized]);

  // ============================================================================
  // Bin Navigation
  // ============================================================================
  const handleSelectBin = useCallback(async (binId: string | null) => {
    // binId: null = "All Projects", '__none__' = unbinned, uuid = specific bin
    setSelectedBinId(binId);
    setShowKanban(true);
    setExpandedProject(null);

    if (binId === null) {
      setSelectedBinName('All Projects');
    } else if (binId === '__none__') {
      setSelectedBinName('Unbinned');
    } else {
      const bin = binsHook.bins.find(b => b.id === binId);
      setSelectedBinName(bin?.name || 'Bin');
    }

    // Fetch projects filtered by this bin
    await fetchProjectsForBin(binId);
  }, [binsHook.bins, fetchProjectsForBin]);

  const handleBackToBins = useCallback(() => {
    setShowKanban(false);
    setExpandedProject(null);
    setSelectedBinId(null);
    setSelectedBinName('All Projects');
    // Refresh bin counts
    binsHook.fetchBins();
  }, [binsHook.fetchBins]);

  const handleCreateBin = useCallback(async (name: string, description?: string) => {
    return binsHook.createBin(name, description);
  }, [binsHook.createBin]);

  const handleDeleteBin = useCallback((binId: string) => {
    binsHook.deleteBin(binId);
  }, [binsHook.deleteBin]);

  const handleRenameBin = useCallback((binId: string, name: string) => {
    binsHook.updateBin(binId, { name });
  }, [binsHook.updateBin]);

  // ============================================================================
  // Initialize fields when expanding a project
  // ============================================================================
  useEffect(() => {
    if (expandedProject) {
      setEditingProjectFields({
        title: expandedProject.title,
        description: expandedProject.description || '',
        status: expandedProject.status,
        priority: expandedProject.priority,
        assigned_staff: expandedProject.project_assignments?.map(a => a.user_id) || [],
        department_id: expandedProject.department_id || '',
        scheduled_date: expandedProject.scheduled_date || '',
        scheduled_time: expandedProject.scheduled_time || ''
      });
      // Use LOCAL hook instances
      commentsHook.fetchProjectComments(expandedProject.id);
      attachmentsHook.fetchProjectAttachments(expandedProject.id);
      timeTrackingHook.fetchProjectTimeEntries(expandedProject.id);
    }
  }, [expandedProject?.id]); // Only re-run when project ID changes

  // ============================================================================
  // Wrapper functions that use LOCAL state with LOCAL hook mutations
  // ============================================================================
  const handleSaveProject = useCallback(async () => {
    const currentFields = editingFieldsRef.current;
    if (!expandedProject || !currentFields) return;
    const updatedProject = await saveProjectById(expandedProject.id, currentFields);
    if (updatedProject) {
      setExpandedProject(updatedProject);
    }
  }, [expandedProject, saveProjectById]);

  const handlePostComment = useCallback(async () => {
    if (!expandedProject || !newComment.trim()) return;
    await commentsHook.postProjectComment(expandedProject.id, newComment);
    setNewComment('');
  }, [expandedProject, newComment, commentsHook]);

  const handleAttachmentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!expandedProject) return;
    attachmentsHook.handleAttachmentUpload(e, expandedProject.id);
  }, [expandedProject, attachmentsHook]);

  const handleStartTimer = useCallback(() => {
    if (!expandedProject) return;
    timeTrackingHook.startProjectTimer(expandedProject.id);
  }, [expandedProject, timeTrackingHook]);

  const handleOpenActivity = useCallback(() => {
    if (expandedProject) {
      activityHook.fetchProjectActivity(expandedProject.id);
      setActivityPopoverOpen(true);
    }
  }, [expandedProject, activityHook]);

  // Memoized handler for project selection
  const handleProjectSelect = useCallback((project: Project) => {
    if (expandedProject?.id === project.id) {
      setExpandedProject(null);
    } else {
      setExpandedProject(project);
      recordProjectView(project.id);
    }
  }, [expandedProject?.id, recordProjectView]);

  // Handle creating a new project - bypasses dialog, auto-expands in detail panel
  const handleNewProject = useCallback(async () => {
    const newProject = await createProjectForProperty('');
    if (newProject) {
      setExpandedProject(newProject);
      recordProjectView(newProject.id);
    }
  }, [createProjectForProperty, recordProjectView]);

  // Handle kanban column moves (drag-and-drop between columns)
  const handleColumnMove = useCallback(
    (projectId: string, field: string, value: string) => {
      updateProjectField(projectId, field, value);
    },
    [updateProjectField]
  );

  // ============================================================================
  // RENDER: Bin Picker screen vs Kanban screen
  // ============================================================================
  if (!showKanban) {
    return (
      <BinPicker
        bins={binsHook.bins}
        loadingBins={binsHook.loadingBins}
        totalProjects={binsHook.totalProjects}
        unbinnedCount={binsHook.unbinnedCount}
        onSelectBin={handleSelectBin}
        onCreateBin={handleCreateBin}
        onDeleteBin={handleDeleteBin}
        onRenameBin={handleRenameBin}
      />
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Kanban Board */}
      <div className={`${expandedProject ? 'w-2/3' : 'w-full'} h-full flex flex-col transition-[width] duration-200 ease-out`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Back to bins button */}
            <button
              onClick={handleBackToBins}
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Bins
            </button>
            <span className="text-neutral-300 dark:text-neutral-600">/</span>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
              {selectedBinName}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-lg p-0.5">
              {(['property', 'status', 'priority'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === mode
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {mode === 'property' ? 'Property' : mode === 'status' ? 'Status' : 'Priority'}
                </button>
              ))}
            </div>
            {/* Column Picker */}
            <ColumnPicker
              columns={allColumnOptions}
              visibleColumnIds={columnVis.visibleIds}
              onToggle={columnVis.toggle}
              onSelectAll={() => columnVis.selectAll(allColumnOptions.map((c) => c.id))}
              onClearAll={columnVis.clearAll}
            />
            <Button size="sm" onClick={handleNewProject}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New Project
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        {loadingProjects ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-neutral-500">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                No projects in this bin yet.
              </p>
              <Button onClick={handleNewProject}>
                Create First Project
              </Button>
            </div>
          </div>
        ) : (
          <ProjectsKanban
            projects={projects}
            viewMode={viewMode}
            allProperties={allProperties}
            onProjectClick={handleProjectSelect}
            expandedProjectId={expandedProject?.id || null}
            getUnreadCommentCount={getUnreadCommentCount}
            onColumnMove={handleColumnMove}
            visibleColumnIds={columnVis.visibleIds}
          />
        )}
      </div>

      {/* Right Panel - Project Detail */}
      {expandedProject && editingProjectFields && (
        <div className="w-1/3 flex-shrink-0 border-l border-neutral-200 dark:border-neutral-700">
        <ProjectDetailPanel
          project={expandedProject}
          editingFields={editingProjectFields}
          setEditingFields={setEditingProjectFields}
          users={users}
          allProperties={allProperties}
          savingEdit={savingProjectEdit}
          onSave={handleSaveProject}
          onDelete={deleteProject}
          onClose={() => setExpandedProject(null)}
          onOpenActivity={handleOpenActivity}
          onPropertyChange={async (propertyId, propertyName) => {
            await updateProjectField(expandedProject.id, 'property_id', propertyId || '');
            if (propertyName !== undefined) {
              await updateProjectField(expandedProject.id, 'property_name', propertyName || '');
            }
            // Update the local expanded project to reflect change
            setExpandedProject(prev => prev ? { ...prev, property_id: propertyId, property_name: propertyName } : null);
          }}
          // Comments - use LOCAL hook
          comments={commentsHook.projectComments as Comment[]}
          loadingComments={commentsHook.loadingComments}
          newComment={newComment}
          setNewComment={setNewComment}
          postingComment={commentsHook.postingComment}
          onPostComment={handlePostComment}
          // Attachments - use LOCAL hook
          attachments={attachmentsHook.projectAttachments as Attachment[]}
          loadingAttachments={attachmentsHook.loadingAttachments}
          uploadingAttachment={attachmentsHook.uploadingAttachment}
          attachmentInputRef={attachmentsHook.attachmentInputRef}
          onAttachmentUpload={handleAttachmentUpload}
          onViewAttachment={setViewingAttachmentIndex}
          // Time tracking - use LOCAL hook
          activeTimeEntry={timeTrackingHook.activeTimeEntry}
          displaySeconds={timeTrackingHook.displaySeconds}
          formatTime={timeTrackingHook.formatTime}
          onStartTimer={handleStartTimer}
          onStopTimer={timeTrackingHook.stopProjectTimer}
          // Popover states
          staffOpen={staffOpen}
          setStaffOpen={setStaffOpen}
        />
        </div>
      )}

      {/* Activity History Sheet - use LOCAL hook */}
      <ProjectActivitySheet
        open={activityPopoverOpen}
        onOpenChange={setActivityPopoverOpen}
        activities={activityHook.projectActivity}
        loading={activityHook.loadingActivity}
      />

      {/* Attachment Lightbox - use LOCAL hook */}
      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments as Attachment[]}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />

    </div>
  );
}

const ProjectsWindow = memo(ProjectsWindowContent);
export default ProjectsWindow;
