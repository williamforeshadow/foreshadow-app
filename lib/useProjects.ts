'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { 
  Project, 
  User,
  ProjectFormFields 
} from '@/lib/types';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';

// Re-export for backward compatibility
export type { ProjectFormFields } from '@/lib/types';

interface UseProjectsProps {
  currentUser: User | null;
}

export function useProjects({ currentUser }: UseProjectsProps) {
  // ============================================================================
  // Core Project State
  // ============================================================================
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [allProperties, setAllProperties] = useState<string[]>([]);

  // Project views (for "new" badge)
  const [projectViews, setProjectViews] = useState<Record<string, string>>({});

  // ============================================================================
  // Dialog State (Create/Edit)
  // ============================================================================
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [projectForm, setProjectForm] = useState({
    property_name: '',
    title: '',
    description: '',
    status: 'not_started',
    priority: 'medium',
    assigned_staff: '',
    due_date: ''
  });

  // ============================================================================
  // Expanded Project Detail State
  // ============================================================================
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [editingProjectFields, setEditingProjectFields] = useState<ProjectFormFields | null>(null);
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);
  const [discussionExpanded, setDiscussionExpanded] = useState(false);

  // Popover states
  const [projectStaffOpen, setProjectStaffOpen] = useState(false);
  const [projectDueDateOpen, setProjectDueDateOpen] = useState(false);

  // ============================================================================
  // Composed Hooks
  // ============================================================================
  const comments = useProjectComments({ currentUser });
  const attachments = useProjectAttachments({ currentUser });
  const timeTracking = useProjectTimeTracking({ currentUser });
  const activity = useProjectActivity();

  // ============================================================================
  // Data Fetching
  // ============================================================================
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const response = await fetch('/api/projects');
      const result = await response.json();
      if (response.ok && result.data) {
        setProjects(result.data);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const fetchAllProperties = useCallback(async () => {
    try {
      const response = await fetch('/api/properties');
      const result = await response.json();
      if (response.ok && result.data) {
        setAllProperties(result.data.map((p: { name: string }) => p.name));
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  }, []);

  const fetchProjectViews = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const response = await fetch(`/api/project-views?user_id=${currentUser.id}`);
      const result = await response.json();
      if (response.ok && result.data) {
        setProjectViews(result.data);
      }
    } catch (err) {
      console.error('Error fetching project views:', err);
    }
  }, [currentUser?.id]);

  // ============================================================================
  // Project Views (Read Tracking)
  // ============================================================================
  const recordProjectView = useCallback(async (projectId: string) => {
    if (!currentUser?.id) return;
    try {
      await fetch('/api/project-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          user_id: currentUser.id
        })
      });
      setProjectViews(prev => ({
        ...prev,
        [projectId]: new Date().toISOString()
      }));
    } catch (err) {
      console.error('Error recording project view:', err);
    }
  }, [currentUser?.id]);

  const hasUnreadActivity = useCallback((project: Project): boolean => {
    const lastViewed = projectViews[project.id];
    if (!lastViewed) return true;
    const projectUpdated = new Date(project.updated_at).getTime();
    const userViewed = new Date(lastViewed).getTime();
    return projectUpdated > userViewed;
  }, [projectViews]);

  // ============================================================================
  // Dialog Operations
  // ============================================================================
  const resetProjectForm = useCallback(() => {
    setProjectForm({
      property_name: '',
      title: '',
      description: '',
      status: 'not_started',
      priority: 'medium',
      assigned_staff: '',
      due_date: ''
    });
    setEditingProject(null);
  }, []);

  const openCreateProjectDialog = useCallback((propertyName?: string) => {
    resetProjectForm();
    if (propertyName) {
      setProjectForm(prev => ({ ...prev, property_name: propertyName }));
    }
    setShowProjectDialog(true);
  }, [resetProjectForm]);

  const openEditProjectDialog = useCallback((project: Project) => {
    setProjectForm({
      property_name: project.property_name,
      title: project.title,
      description: project.description || '',
      status: project.status,
      priority: project.priority,
      assigned_staff: project.assigned_staff || '',
      due_date: project.due_date || ''
    });
    setEditingProject(project);
    setShowProjectDialog(true);
  }, []);

  // ============================================================================
  // CRUD Operations
  // ============================================================================
  const saveProject = useCallback(async () => {
    if (!projectForm.property_name || !projectForm.title) return;

    setSavingProject(true);
    try {
      const payload = {
        property_name: projectForm.property_name,
        title: projectForm.title,
        description: projectForm.description || null,
        status: projectForm.status,
        priority: projectForm.priority,
        assigned_staff: projectForm.assigned_staff || null,
        due_date: projectForm.due_date ? new Date(projectForm.due_date).toISOString() : null
      };

      const url = editingProject
        ? `/api/projects/${editingProject.id}`
        : '/api/projects';

      const response = await fetch(url, {
        method: editingProject ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save project');
      }

      if (editingProject) {
        setProjects(prev => prev.map(p => p.id === editingProject.id ? result.data : p));
      } else {
        setProjects(prev => [...prev, result.data]);
      }

      setShowProjectDialog(false);
      resetProjectForm();
    } catch (err) {
      console.error('Error saving project:', err);
    } finally {
      setSavingProject(false);
    }
  }, [projectForm, editingProject, resetProjectForm]);

  const deleteProject = useCallback(async (project: Project) => {
    if (!confirm(`Delete project "${project.title}"?`)) return;

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete project');
      }

      setProjects(prev => prev.filter(p => p.id !== project.id));
      if (expandedProject?.id === project.id) {
        setExpandedProject(null);
      }
    } catch (err) {
      console.error('Error deleting project:', err);
    }
  }, [expandedProject]);

  const saveProjectChanges = useCallback(async () => {
    if (!expandedProject || !editingProjectFields || !currentUser) return;

    setSavingProjectEdit(true);
    try {
      const res = await fetch(`/api/projects/${expandedProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingProjectFields.title,
          description: editingProjectFields.description || null,
          status: editingProjectFields.status,
          priority: editingProjectFields.priority,
          assigned_user_ids: editingProjectFields.assigned_staff ? [editingProjectFields.assigned_staff] : [],
          due_date: editingProjectFields.due_date || null,
          user_id: currentUser.id
        })
      });

      const data = await res.json();
      if (data.data) {
        setProjects(prev => prev.map(p => p.id === expandedProject.id ? data.data : p));
        setExpandedProject(data.data);
      }
    } catch (err) {
      console.error('Error saving project:', err);
    } finally {
      setSavingProjectEdit(false);
    }
  }, [expandedProject, editingProjectFields, currentUser]);

  // ============================================================================
  // Effects
  // ============================================================================
  
  // Auto-load on mount
  useEffect(() => {
    fetchProjects();
    fetchAllProperties();
    fetchProjectViews();
  }, [fetchProjects, fetchAllProperties, fetchProjectViews]);

  // Load project details when expanded
  useEffect(() => {
    if (expandedProject) {
      setEditingProjectFields({
        title: expandedProject.title,
        description: expandedProject.description || '',
        status: expandedProject.status,
        priority: expandedProject.priority,
        assigned_staff: expandedProject.project_assignments?.[0]?.user_id || '',
        due_date: expandedProject.due_date || ''
      });
      comments.fetchProjectComments(expandedProject.id);
      attachments.fetchProjectAttachments(expandedProject.id);
      timeTracking.fetchProjectTimeEntries(expandedProject.id);
    }
  }, [expandedProject, comments.fetchProjectComments, attachments.fetchProjectAttachments, timeTracking.fetchProjectTimeEntries]);

  // ============================================================================
  // Computed Values
  // ============================================================================
  const groupedProjects = useMemo(() => {
    return projects.reduce((acc, project) => {
      if (!acc[project.property_name]) {
        acc[project.property_name] = [];
      }
      acc[project.property_name].push(project);
      return acc;
    }, {} as Record<string, Project[]>);
  }, [projects]);

  // ============================================================================
  // Return API
  // ============================================================================
  return {
    // Core data
    projects,
    setProjects,
    loadingProjects,
    groupedProjects,
    allProperties,

    // Project views
    projectViews,
    recordProjectView,
    hasUnreadActivity,

    // Dialog state
    showProjectDialog,
    setShowProjectDialog,
    editingProject,
    projectForm,
    setProjectForm,
    savingProject,
    openCreateProjectDialog,
    openEditProjectDialog,
    saveProject,
    deleteProject,

    // Expanded project
    expandedProject,
    setExpandedProject,
    editingProjectFields,
    setEditingProjectFields,
    savingProjectEdit,
    saveProjectChanges,
    discussionExpanded,
    setDiscussionExpanded,

    // Comments (from composed hook)
    projectComments: comments.projectComments,
    loadingComments: comments.loadingComments,
    newComment: comments.newComment,
    setNewComment: comments.setNewComment,
    postingComment: comments.postingComment,
    postProjectComment: () => expandedProject && comments.postProjectComment(expandedProject.id),
    fetchProjectComments: comments.fetchProjectComments,

    // Attachments (from composed hook)
    projectAttachments: attachments.projectAttachments,
    loadingAttachments: attachments.loadingAttachments,
    uploadingAttachment: attachments.uploadingAttachment,
    viewingAttachmentIndex: attachments.viewingAttachmentIndex,
    setViewingAttachmentIndex: attachments.setViewingAttachmentIndex,
    attachmentInputRef: attachments.attachmentInputRef,
    handleAttachmentUpload: (e: React.ChangeEvent<HTMLInputElement>) => 
      expandedProject && attachments.handleAttachmentUpload(e, expandedProject.id),
    navigateAttachment: attachments.navigateAttachment,

    // Time tracking (from composed hook)
    projectTimeEntries: timeTracking.projectTimeEntries,
    activeTimeEntry: timeTracking.activeTimeEntry,
    totalTrackedSeconds: timeTracking.totalTrackedSeconds,
    displaySeconds: timeTracking.displaySeconds,
    startProjectTimer: () => expandedProject && timeTracking.startProjectTimer(expandedProject.id),
    stopProjectTimer: timeTracking.stopProjectTimer,
    formatTime: timeTracking.formatTime,

    // Activity (from composed hook)
    projectActivity: activity.projectActivity,
    loadingActivity: activity.loadingActivity,
    activityPopoverOpen: activity.activityPopoverOpen,
    setActivityPopoverOpen: activity.setActivityPopoverOpen,
    fetchProjectActivity: activity.fetchProjectActivity,

    // Popover states
    projectStaffOpen,
    setProjectStaffOpen,
    projectDueDateOpen,
    setProjectDueDateOpen,
  };
}
