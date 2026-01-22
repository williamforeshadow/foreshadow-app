'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { 
  Project, 
  User,
  ProjectFormFields,
  ProjectStatus,
  ProjectPriority 
} from '@/lib/types';

// View mode type for project grouping
export type ProjectViewMode = 'property' | 'status' | 'priority';

// Labels for display
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  'not_started': 'Not Started',
  'in_progress': 'In Progress',
  'on_hold': 'On Hold',
  'complete': 'Complete'
};

export const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  'urgent': 'Urgent',
  'high': 'High',
  'medium': 'Medium',
  'low': 'Low'
};

// Ordered arrays for consistent column order
export const STATUS_ORDER: ProjectStatus[] = ['not_started', 'in_progress', 'on_hold', 'complete'];
export const PRIORITY_ORDER: ProjectPriority[] = ['urgent', 'high', 'medium', 'low'];
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
  // Core Project State (SHARED - data that should sync across windows)
  // ============================================================================
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [allProperties, setAllProperties] = useState<string[]>([]);
  
  // View mode for kanban-style grouping
  const [viewMode, setViewMode] = useState<ProjectViewMode>('property');

  // Project views (for "new" badge)
  const [projectViews, setProjectViews] = useState<Record<string, string>>({});

  // ============================================================================
  // Dialog State (Create/Edit) - SHARED since dialog is global
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
    scheduled_start: ''
  });

  // Saving state for project edits (shared loading indicator)
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);

  // ============================================================================
  // Composed Hooks (expose their functions directly for window-level use)
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
      const url = currentUser?.id 
        ? `/api/projects?viewer_user_id=${currentUser.id}` 
        : '/api/projects';
      const response = await fetch(url);
      const result = await response.json();
      if (response.ok && result.data) {
        setProjects(result.data);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  }, [currentUser?.id]);

  const fetchAllProperties = useCallback(async () => {
    try {
      const response = await fetch('/api/properties');
      const result = await response.json();
      if (response.ok && result.properties) {
        setAllProperties(result.properties);
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
      // Clear the unread count locally so badge disappears immediately
      setProjects(prev => prev.map(p => 
        p.id === projectId 
          ? { ...p, unread_comment_count: 0 } as any
          : p
      ));
    } catch (err) {
      console.error('Error recording project view:', err);
    }
  }, [currentUser?.id]);

  // Get unread comment count from the project data (calculated by API)
  const getUnreadCommentCount = useCallback((project: Project): number => {
    return (project as any).unread_comment_count || 0;
  }, []);

  // Legacy function for backward compatibility - now based on unread comments
  const hasUnreadActivity = useCallback((project: Project): boolean => {
    return getUnreadCommentCount(project) > 0;
  }, [getUnreadCommentCount]);

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
      scheduled_start: ''
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
      scheduled_start: project.scheduled_start || ''
    });
    setEditingProject(project);
    setShowProjectDialog(true);
  }, []);

  // ============================================================================
  // CRUD Operations
  // ============================================================================
  const saveProject = useCallback(async (): Promise<Project | null> => {
    // Only property_name is required for new projects (title defaults to "New Project")
    if (!projectForm.property_name) return null;
    // For editing, title is required
    if (editingProject && !projectForm.title) return null;

    setSavingProject(true);
    try {
      const payload = {
        property_name: projectForm.property_name,
        title: projectForm.title || 'New Project',
        description: projectForm.description || null,
        status: projectForm.status,
        priority: projectForm.priority,
        assigned_staff: projectForm.assigned_staff || null,
        scheduled_start: projectForm.scheduled_start ? new Date(projectForm.scheduled_start).toISOString() : null
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
      
      // Return the created/updated project so caller can use it
      return result.data as Project;
    } catch (err) {
      console.error('Error saving project:', err);
      return null;
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
    } catch (err) {
      console.error('Error deleting project:', err);
    }
  }, []);

  // Create a new project directly for a given property (without dialog)
  const createProjectForProperty = useCallback(async (propertyName: string): Promise<Project | null> => {
    setSavingProject(true);
    try {
      const payload = {
        property_name: propertyName,
        title: 'New Project',
        description: null,
        status: 'not_started',
        priority: 'medium',
        assigned_staff: null,
        scheduled_start: null
      };

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create project');
      }

      setProjects(prev => [...prev, result.data]);
      return result.data as Project;
    } catch (err) {
      console.error('Error creating project:', err);
      return null;
    } finally {
      setSavingProject(false);
    }
  }, []);

  // Parameterized save function - accepts project ID and fields from caller
  // Returns the updated project so caller can update their local state
  const saveProjectById = useCallback(async (
    projectId: string, 
    fields: ProjectFormFields
  ): Promise<Project | null> => {
    if (!currentUser) return null;

    setSavingProjectEdit(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fields.title,
          description: fields.description || null,
          status: fields.status,
          priority: fields.priority,
          assigned_user_ids: fields.assigned_staff ? [fields.assigned_staff] : [],
          scheduled_start: fields.scheduled_start || null,
          user_id: currentUser.id
        })
      });

      const data = await res.json();
      if (data.data) {
        // Update shared projects array
        setProjects(prev => prev.map(p => p.id === projectId ? data.data : p));
        return data.data as Project;
      }
      return null;
    } catch (err) {
      console.error('Error saving project:', err);
      return null;
    } finally {
      setSavingProjectEdit(false);
    }
  }, [currentUser]);

  // ============================================================================
  // Effects
  // ============================================================================
  
  // Auto-load on mount
  useEffect(() => {
    fetchProjects();
    fetchAllProperties();
    fetchProjectViews();
  }, [fetchProjects, fetchAllProperties, fetchProjectViews]);

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

  // Group projects by status (for kanban view)
  const groupedByStatus = useMemo(() => {
    return STATUS_ORDER.reduce((acc, status) => {
      acc[status] = projects.filter(p => p.status === status);
      return acc;
    }, {} as Record<ProjectStatus, Project[]>);
  }, [projects]);

  // Group projects by priority (for kanban view)
  const groupedByPriority = useMemo(() => {
    return PRIORITY_ORDER.reduce((acc, priority) => {
      acc[priority] = projects.filter(p => p.priority === priority);
      return acc;
    }, {} as Record<ProjectPriority, Project[]>);
  }, [projects]);

  // ============================================================================
  // Return API
  // ============================================================================
  return {
    // Core data (SHARED)
    projects,
    setProjects,
    loadingProjects,
    groupedProjects,
    groupedByStatus,
    groupedByPriority,
    allProperties,
    
    // View mode
    viewMode,
    setViewMode,

    // Project views (SHARED)
    projectViews,
    recordProjectView,
    hasUnreadActivity,
    getUnreadCommentCount,

    // Dialog state (SHARED - one dialog for all)
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
    createProjectForProperty,

    // Parameterized save function for window-specific use
    saveProjectById,
    savingProjectEdit,

    // Comments - expose sub-hook functions directly (parameterized by project ID)
    projectComments: comments.projectComments,
    loadingComments: comments.loadingComments,
    postingComment: comments.postingComment,
    fetchProjectComments: comments.fetchProjectComments,
    postProjectComment: comments.postProjectComment,

    // Attachments - expose sub-hook functions directly (parameterized by project ID)
    projectAttachments: attachments.projectAttachments,
    loadingAttachments: attachments.loadingAttachments,
    uploadingAttachment: attachments.uploadingAttachment,
    attachmentInputRef: attachments.attachmentInputRef,
    fetchProjectAttachments: attachments.fetchProjectAttachments,
    handleAttachmentUpload: attachments.handleAttachmentUpload,
    navigateAttachment: attachments.navigateAttachment,

    // Time tracking - expose sub-hook functions directly (parameterized by project ID)
    projectTimeEntries: timeTracking.projectTimeEntries,
    activeTimeEntry: timeTracking.activeTimeEntry,
    totalTrackedSeconds: timeTracking.totalTrackedSeconds,
    displaySeconds: timeTracking.displaySeconds,
    fetchProjectTimeEntries: timeTracking.fetchProjectTimeEntries,
    startProjectTimer: timeTracking.startProjectTimer,
    stopProjectTimer: timeTracking.stopProjectTimer,
    formatTime: timeTracking.formatTime,

    // Activity - expose sub-hook functions directly (parameterized by project ID)
    projectActivity: activity.projectActivity,
    loadingActivity: activity.loadingActivity,
    fetchProjectActivity: activity.fetchProjectActivity,
  };
}
