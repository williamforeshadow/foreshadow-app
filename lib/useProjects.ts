'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { 
  Project, 
  Comment, 
  Attachment, 
  TimeEntry, 
  ActivityLogEntry,
  User,
  ProjectFormFields 
} from '@/lib/types';

// Re-export for backward compatibility
export type { ProjectFormFields } from '@/lib/types';

interface UseProjectsProps {
  currentUser: User | null;
}

export function useProjects({ currentUser }: UseProjectsProps) {
  // Core project data
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [allProperties, setAllProperties] = useState<string[]>([]);

  // Project views (for "new" badge)
  const [projectViews, setProjectViews] = useState<Record<string, string>>({});

  // Create/edit dialog state
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

  // Expanded project detail pane
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [editingProjectFields, setEditingProjectFields] = useState<ProjectFormFields | null>(null);
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);
  const [discussionExpanded, setDiscussionExpanded] = useState(false);

  // Comments
  const [projectComments, setProjectComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Attachments
  const [projectAttachments, setProjectAttachments] = useState<Attachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Time tracking
  const [projectTimeEntries, setProjectTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimeEntry, setActiveTimeEntry] = useState<TimeEntry | null>(null);
  const [totalTrackedSeconds, setTotalTrackedSeconds] = useState(0);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Activity log
  const [projectActivity, setProjectActivity] = useState<ActivityLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);

  // Popover states
  const [projectStaffOpen, setProjectStaffOpen] = useState(false);
  const [projectDueDateOpen, setProjectDueDateOpen] = useState(false);

  // Fetch projects
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

  // Fetch all properties
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

  // Fetch project views
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

  // Record project view
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

  // Check if project has unread activity
  const hasUnreadActivity = useCallback((project: Project): boolean => {
    const lastViewed = projectViews[project.id];
    if (!lastViewed) return true;
    const projectUpdated = new Date(project.updated_at).getTime();
    const userViewed = new Date(lastViewed).getTime();
    return projectUpdated > userViewed;
  }, [projectViews]);

  // Reset form
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

  // Open create dialog
  const openCreateProjectDialog = useCallback((propertyName?: string) => {
    resetProjectForm();
    if (propertyName) {
      setProjectForm(prev => ({ ...prev, property_name: propertyName }));
    }
    setShowProjectDialog(true);
  }, [resetProjectForm]);

  // Open edit dialog
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

  // Save project (create or update)
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

  // Delete project
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

  // Fetch comments
  const fetchProjectComments = useCallback(async (projectId: string) => {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/project-comments?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectComments(data.data);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
      setProjectComments([]);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  // Post comment
  const postProjectComment = useCallback(async () => {
    if (!expandedProject || !newComment.trim() || !currentUser) return;

    setPostingComment(true);
    try {
      const res = await fetch('/api/project-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: expandedProject.id,
          user_id: currentUser.id,
          comment_content: newComment.trim()
        })
      });

      const data = await res.json();
      if (data.success && data.data) {
        setProjectComments(prev => [...prev, data.data]);
        setNewComment('');
      }
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setPostingComment(false);
    }
  }, [expandedProject, newComment, currentUser]);

  // Fetch attachments
  const fetchProjectAttachments = useCallback(async (projectId: string) => {
    setLoadingAttachments(true);
    try {
      const res = await fetch(`/api/project-attachments?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectAttachments(data.data);
      }
    } catch (err) {
      console.error('Error fetching attachments:', err);
      setProjectAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  }, []);

  // Handle attachment upload
  const handleAttachmentUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !expandedProject || !currentUser) return;

    setUploadingAttachment(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('project_id', expandedProject.id);
        formData.append('uploaded_by', currentUser.id);

        const res = await fetch('/api/project-attachments', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (data.data) {
          setProjectAttachments(prev => [data.data, ...prev]);
        }
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
    }
  }, [expandedProject, currentUser]);

  // Navigate attachments
  const navigateAttachment = useCallback((direction: 'prev' | 'next') => {
    if (viewingAttachmentIndex === null) return;
    const newIndex = direction === 'prev'
      ? (viewingAttachmentIndex - 1 + projectAttachments.length) % projectAttachments.length
      : (viewingAttachmentIndex + 1) % projectAttachments.length;
    setViewingAttachmentIndex(newIndex);
  }, [viewingAttachmentIndex, projectAttachments.length]);

  // Fetch time entries
  const fetchProjectTimeEntries = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/project-time-entries?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectTimeEntries(data.data);
        setTotalTrackedSeconds(data.totalSeconds || 0);
        setActiveTimeEntry(data.activeEntry || null);

        if (data.activeEntry) {
          const activeStart = new Date(data.activeEntry.start_time).getTime();
          const now = Date.now();
          const activeSeconds = Math.floor((now - activeStart) / 1000);
          setDisplaySeconds((data.totalSeconds || 0) + activeSeconds);
        } else {
          setDisplaySeconds(data.totalSeconds || 0);
        }
      }
    } catch (err) {
      console.error('Error fetching time entries:', err);
      setProjectTimeEntries([]);
      setTotalTrackedSeconds(0);
      setActiveTimeEntry(null);
      setDisplaySeconds(0);
    }
  }, []);

  // Start timer
  const startProjectTimer = useCallback(async () => {
    if (!expandedProject || !currentUser) return;

    try {
      const res = await fetch('/api/project-time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: expandedProject.id,
          user_id: currentUser.id
        })
      });

      const data = await res.json();
      if (data.data) {
        setActiveTimeEntry(data.data);
        setProjectTimeEntries(prev => [data.data, ...prev]);
      }
    } catch (err) {
      console.error('Error starting timer:', err);
    }
  }, [expandedProject, currentUser]);

  // Stop timer
  const stopProjectTimer = useCallback(async () => {
    if (!activeTimeEntry) return;

    try {
      const res = await fetch('/api/project-time-entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: activeTimeEntry.id
        })
      });

      const data = await res.json();
      if (data.data) {
        setProjectTimeEntries(prev =>
          prev.map(e => e.id === data.data.id ? data.data : e)
        );
        const entryDuration = Math.floor(
          (new Date(data.data.end_time).getTime() - new Date(data.data.start_time).getTime()) / 1000
        );
        setTotalTrackedSeconds(prev => prev + entryDuration);
        setActiveTimeEntry(null);
      }
    } catch (err) {
      console.error('Error stopping timer:', err);
    }
  }, [activeTimeEntry]);

  // Format time
  const formatTime = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Fetch activity
  const fetchProjectActivity = useCallback(async (projectId: string) => {
    setLoadingActivity(true);
    try {
      const res = await fetch(`/api/project-activity?project_id=${projectId}&limit=50`);
      const data = await res.json();
      if (data.data) {
        setProjectActivity(data.data);
      }
    } catch (err) {
      console.error('Error fetching activity:', err);
      setProjectActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  // Save project changes (inline edit)
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

  // Timer interval effect
  useEffect(() => {
    if (activeTimeEntry) {
      timerIntervalRef.current = setInterval(() => {
        const activeStart = new Date(activeTimeEntry.start_time).getTime();
        const now = Date.now();
        const activeSeconds = Math.floor((now - activeStart) / 1000);
        setDisplaySeconds(totalTrackedSeconds + activeSeconds);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [activeTimeEntry, totalTrackedSeconds]);

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
      fetchProjectComments(expandedProject.id);
      fetchProjectAttachments(expandedProject.id);
      fetchProjectTimeEntries(expandedProject.id);
    }
  }, [expandedProject, fetchProjectComments, fetchProjectAttachments, fetchProjectTimeEntries]);

  // Group projects by property (memoized to prevent recalculation on every render)
  const groupedProjects = useMemo(() => {
    return projects.reduce((acc, project) => {
      if (!acc[project.property_name]) {
        acc[project.property_name] = [];
      }
      acc[project.property_name].push(project);
      return acc;
    }, {} as Record<string, any[]>);
  }, [projects]);

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

    // Comments
    projectComments,
    loadingComments,
    newComment,
    setNewComment,
    postingComment,
    postProjectComment,
    fetchProjectComments,

    // Attachments
    projectAttachments,
    loadingAttachments,
    uploadingAttachment,
    viewingAttachmentIndex,
    setViewingAttachmentIndex,
    attachmentInputRef,
    handleAttachmentUpload,
    navigateAttachment,

    // Time tracking
    projectTimeEntries,
    activeTimeEntry,
    totalTrackedSeconds,
    displaySeconds,
    startProjectTimer,
    stopProjectTimer,
    formatTime,

    // Activity
    projectActivity,
    loadingActivity,
    activityPopoverOpen,
    setActivityPopoverOpen,
    fetchProjectActivity,

    // Popover states
    projectStaffOpen,
    setProjectStaffOpen,
    projectDueDateOpen,
    setProjectDueDateOpen,
  };
}
