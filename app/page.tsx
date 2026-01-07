'use client';

import { useState, useEffect, memo, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Field,
  FieldLabel,
} from '@/components/ui/field';
import { ChevronDownIcon, CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemRight,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUsers } from '@/lib/useUsers';
import Timeline from '@/components/Timeline';
import FloatingWindow from '@/components/FloatingWindow';
import CleaningForm from '@/components/CleaningForm';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import TurnoverCards from '@/components/TurnoverCards';
import TurnoversWindow from '@/components/windows/TurnoversWindow';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import { AiChat } from '@/components/AiChat';

// Mobile imports
import { useIsMobile } from '@/lib/useIsMobile';
import { useAuth } from '@/lib/authContext';
import { 
  MobileLayout, 
  MobileTimelineView, 
  MobileMyAssignmentsView,
  type MobileTab 
} from '@/components/mobile';

export default function Home() {
  // Mobile detection
  const isMobile = useIsMobile();
  const { user: currentUser } = useAuth();
  const { users } = useUsers();
  const [mobileTab, setMobileTab] = useState<MobileTab>('assignments');
  
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [currentTemplate, setCurrentTemplate] = useState<any>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [allTemplates, setAllTemplates] = useState<any[]>([]);
  const [allProperties, setAllProperties] = useState<string[]>([]);
  const [updatingCardAction, setUpdatingCardAction] = useState(false);
  const [isEditingAssignment, setIsEditingAssignment] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [filters, setFilters] = useState({
    turnoverStatus: [] as string[],
    occupancyStatus: [] as string[],
    timeline: [] as string[],
  });
  const [sortBy, setSortBy] = useState('status-priority');
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);
  const [showProjectsWindow, setShowProjectsWindow] = useState(false);
  const [activeWindow, setActiveWindow] = useState<'cards' | 'timeline' | 'projects'>('cards');
  const [windowOrder, setWindowOrder] = useState<Array<'cards' | 'timeline' | 'projects'>>(['cards', 'timeline', 'projects']);
  const [projects, setProjects] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectViews, setProjectViews] = useState<Record<string, string>>({}); // { project_id: last_viewed_at }
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
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
  const [showCleaningForm, setShowCleaningForm] = useState(false);
  const [editingTaskStaff, setEditingTaskStaff] = useState<string | null>(null);
  const [newTaskStaffName, setNewTaskStaffName] = useState('');
  const [taskTemplates, setTaskTemplates] = useState<{[key: string]: any}>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<'tasks' | 'projects'>('tasks'); // Toggle between tasks and projects in turnover detail
  const [fullscreenTask, setFullscreenTask] = useState<any>(null);
  const [mobileSelectedTask, setMobileSelectedTask] = useState<any>(null); // Mobile task detail sheet
  const [mobileRefreshTrigger, setMobileRefreshTrigger] = useState(0); // Trigger to refresh mobile assignments
  
  // Expanded project view within turnovers window (separate from projects window)
  const [expandedTurnoverProject, setExpandedTurnoverProject] = useState<any>(null);
  const [turnoverProjectFields, setTurnoverProjectFields] = useState<{
    title: string;
    description: string;
    status: string;
    priority: string;
    assigned_staff: string;
    due_date: string;
  } | null>(null);
  const [turnoverDiscussionExpanded, setTurnoverDiscussionExpanded] = useState(false);
  const [savingTurnoverProject, setSavingTurnoverProject] = useState(false);
  const [expandedProject, setExpandedProject] = useState<any>(null);
  
  // Refs for scroll position preservation
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  
  // Project comments state
  const [projectComments, setProjectComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  
  // Project attachments state
  const [projectAttachments, setProjectAttachments] = useState<any[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  
  // Project editing state
  const [editingProjectFields, setEditingProjectFields] = useState<{
    title: string;
    description: string;
    status: string;
    priority: string;
    assigned_staff: string;
    due_date: string;
  } | null>(null);
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);
  const [discussionExpanded, setDiscussionExpanded] = useState(false);
  
  // Project time tracking state
  const [projectTimeEntries, setProjectTimeEntries] = useState<any[]>([]);
  const [activeTimeEntry, setActiveTimeEntry] = useState<any>(null);
  const [totalTrackedSeconds, setTotalTrackedSeconds] = useState(0);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Project activity log state
  const [projectActivity, setProjectActivity] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);
  
  // Combobox open states for staff assignment
  const [turnoverStaffOpen, setTurnoverStaffOpen] = useState(false);
  const [projectStaffOpen, setProjectStaffOpen] = useState(false);
  const [projectDueDateOpen, setProjectDueDateOpen] = useState(false);

  // Window stacking order management
  const bringToFront = (window: 'cards' | 'timeline' | 'projects') => {
    setActiveWindow(window);
    setWindowOrder(prev => {
      const filtered = prev.filter(w => w !== window);
      return [...filtered, window]; // Move window to end (top of stack)
    });
  };

  const getZIndex = (window: 'cards' | 'timeline' | 'projects') => {
    const position = windowOrder.indexOf(window);
    return 10 + position; // Base 10, then 11, 12, 13 based on stack position
  };

  // Auto-load data on mount
  useEffect(() => {
    quickCall('get_property_turnovers');
    fetchAllTemplates();
    fetchAllProperties();
  }, []);

  // Fetch projects when Projects window is shown
  useEffect(() => {
    if (showProjectsWindow && projects.length === 0) {
      fetchProjects();
    }
    if (showProjectsWindow && currentUser?.id) {
      fetchProjectViews();
    }
  }, [showProjectsWindow, currentUser?.id]);

  // Also fetch projects when viewing projects in turnover detail
  useEffect(() => {
    if (selectedCard && rightPanelView === 'projects' && projects.length === 0) {
      fetchProjects();
    }
  }, [selectedCard, rightPanelView]);

  // Fetch comments, attachments, and time entries when a project is expanded
  useEffect(() => {
    if (expandedProject?.id) {
      fetchProjectComments(expandedProject.id);
      fetchProjectAttachments(expandedProject.id);
      fetchProjectTimeEntries(expandedProject.id);
      // Initialize editing fields
      setEditingProjectFields({
        title: expandedProject.title || '',
        description: expandedProject.description || '',
        status: expandedProject.status || 'not_started',
        priority: expandedProject.priority || 'medium',
        assigned_staff: expandedProject.project_assignments?.[0]?.user_id || '',
        due_date: expandedProject.due_date || ''
      });
    } else {
      setProjectComments([]);
      setProjectAttachments([]);
      setViewingAttachmentIndex(null);
      setNewComment('');
      setEditingProjectFields(null);
      // Reset time tracking state
      setProjectTimeEntries([]);
      setActiveTimeEntry(null);
      setTotalTrackedSeconds(0);
      setDisplaySeconds(0);
    }
  }, [expandedProject?.id]);

  // Real-time clock update when timer is running
  useEffect(() => {
    if (activeTimeEntry) {
      // Start interval to update display every second
      timerIntervalRef.current = setInterval(() => {
        const activeStart = new Date(activeTimeEntry.start_time).getTime();
        const now = Date.now();
        const activeSeconds = Math.floor((now - activeStart) / 1000);
        setDisplaySeconds(totalTrackedSeconds + activeSeconds);
      }, 1000);
    } else {
      // Clear interval when no active timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setDisplaySeconds(totalTrackedSeconds);
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [activeTimeEntry, totalTrackedSeconds]);

  // Auto-save project changes with debounce
  useEffect(() => {
    if (!expandedProject || !editingProjectFields) return;
    
    // Don't save on initial load - only when fields actually change
    const hasChanges = 
      editingProjectFields.title !== (expandedProject.title || '') ||
      editingProjectFields.description !== (expandedProject.description || '') ||
      editingProjectFields.status !== (expandedProject.status || 'not_started') ||
      editingProjectFields.priority !== (expandedProject.priority || 'medium') ||
      editingProjectFields.assigned_staff !== (expandedProject.project_assignments?.[0]?.user_id || '') ||
      editingProjectFields.due_date !== (expandedProject.due_date || '');
    
    if (!hasChanges) return;
    
    const timeoutId = setTimeout(() => {
      saveProjectChanges();
    }, 800); // 800ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [editingProjectFields]);

  // Restore scroll position after re-renders (runs after every render)
  useEffect(() => {
    if (rightPanelRef.current && scrollPositionRef.current > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (rightPanelRef.current) {
          rightPanelRef.current.scrollTop = scrollPositionRef.current;
        }
      });
    }
  });

  const fetchProjects = async () => {
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
  };

  const fetchProjectViews = async () => {
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
  };

  const recordProjectView = async (projectId: string) => {
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
      // Update local state immediately
      setProjectViews(prev => ({
        ...prev,
        [projectId]: new Date().toISOString()
      }));
    } catch (err) {
      console.error('Error recording project view:', err);
    }
  };

  // Check if a project has unread activity for the current user
  const hasUnreadActivity = (project: any): boolean => {
    const lastViewed = projectViews[project.id];
    if (!lastViewed) return true; // Never viewed = new
    const projectUpdated = new Date(project.updated_at).getTime();
    const userViewed = new Date(lastViewed).getTime();
    return projectUpdated > userViewed;
  };

  const resetProjectForm = () => {
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
  };

  const openCreateProjectDialog = (propertyName?: string) => {
    resetProjectForm();
    if (propertyName) {
      setProjectForm(prev => ({ ...prev, property_name: propertyName }));
    }
    setShowProjectDialog(true);
  };

  const openEditProjectDialog = (project: any) => {
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
  };

  const saveProject = async () => {
    if (!projectForm.property_name || !projectForm.title) {
      setError('Property and title are required');
      return;
    }

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

      // Update local state
      if (editingProject) {
        setProjects(prev => prev.map(p => p.id === editingProject.id ? result.data : p));
      } else {
        setProjects(prev => [...prev, result.data]);
      }

      setShowProjectDialog(false);
      resetProjectForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingProject(false);
    }
  };

  const deleteProject = async (project: any) => {
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
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Project Comments functions
  const fetchProjectComments = async (projectId: string) => {
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
  };

  // Project Attachments functions
  const fetchProjectAttachments = async (projectId: string) => {
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
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !expandedProject) return;
    
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
  };

  const navigateAttachment = (direction: 'prev' | 'next') => {
    if (viewingAttachmentIndex === null) return;
    const newIndex = direction === 'prev' 
      ? (viewingAttachmentIndex - 1 + projectAttachments.length) % projectAttachments.length
      : (viewingAttachmentIndex + 1) % projectAttachments.length;
    setViewingAttachmentIndex(newIndex);
  };

  // Project Time Tracking functions
  const fetchProjectTimeEntries = async (projectId: string) => {
    try {
      const res = await fetch(`/api/project-time-entries?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectTimeEntries(data.data);
        setTotalTrackedSeconds(data.totalSeconds || 0);
        setActiveTimeEntry(data.activeEntry || null);
        
        // Calculate display seconds (total + active running time)
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
  };

  const startProjectTimer = async () => {
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
  };

  const stopProjectTimer = async () => {
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
        // Update the entry in the list
        setProjectTimeEntries(prev => 
          prev.map(e => e.id === data.data.id ? data.data : e)
        );
        // Calculate new total
        const entryDuration = Math.floor(
          (new Date(data.data.end_time).getTime() - new Date(data.data.start_time).getTime()) / 1000
        );
        setTotalTrackedSeconds(prev => prev + entryDuration);
        setActiveTimeEntry(null);
      }
    } catch (err) {
      console.error('Error stopping timer:', err);
    }
  };

  // Format seconds to HH:MM:SS
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Fetch project activity log
  const fetchProjectActivity = async (projectId: string) => {
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
  };

  const postProjectComment = async () => {
    if (!expandedProject || !newComment.trim()) return;
    
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
  };

  const saveProjectChanges = async () => {
    if (!expandedProject || !editingProjectFields) return;
    
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
          user_id: currentUser?.id // For activity logging
        })
      });
      
      const data = await res.json();
      if (data.data) {
        // Update local projects list
        setProjects(prev => prev.map(p => p.id === expandedProject.id ? data.data : p));
        // Update expanded project
        setExpandedProject(data.data);
        // Record view so user doesn't see "new" badge for their own changes
        recordProjectView(expandedProject.id);
      }
    } catch (err) {
      console.error('Error saving project:', err);
    } finally {
      setSavingProjectEdit(false);
    }
  };

  // Save project changes from turnovers window (separate from main projects window)
  const saveTurnoverProjectChanges = async () => {
    if (!expandedTurnoverProject || !turnoverProjectFields) return;
    
    setSavingTurnoverProject(true);
    try {
      const res = await fetch(`/api/projects/${expandedTurnoverProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: turnoverProjectFields.title,
          description: turnoverProjectFields.description || null,
          status: turnoverProjectFields.status,
          priority: turnoverProjectFields.priority,
          assigned_user_ids: turnoverProjectFields.assigned_staff ? [turnoverProjectFields.assigned_staff] : [],
          due_date: turnoverProjectFields.due_date || null
        })
      });
      
      const data = await res.json();
      if (data.data) {
        // Update local projects list
        setProjects(prev => prev.map(p => p.id === expandedTurnoverProject.id ? data.data : p));
        // Update the expanded turnover project
        setExpandedTurnoverProject(data.data);
      }
    } catch (err) {
      console.error('Error saving turnover project:', err);
    } finally {
      setSavingTurnoverProject(false);
    }
  };

  const fetchAllTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.templates) {
        setAllTemplates(data.templates);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  const fetchAllProperties = async () => {
    try {
      const res = await fetch('/api/properties');
      const data = await res.json();
      if (data.properties) {
        setAllProperties(data.properties);
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  };

  // Fetch template when card is selected
  useEffect(() => {
    const fetchTemplate = async () => {
      if (selectedCard?.template_id) {
        setLoadingTemplate(true);
        try {
          const res = await fetch(`/api/templates/${selectedCard.template_id}`);
          const data = await res.json();
          if (data.template) {
            setCurrentTemplate(data.template);
          }
        } catch (err) {
          console.error('Error fetching template:', err);
          setCurrentTemplate(null);
        } finally {
          setLoadingTemplate(false);
        }
      } else {
        setCurrentTemplate(null);
      }
    };

    fetchTemplate();
  }, [selectedCard?.template_id]);

  const quickCall = async (rpcName: string) => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(rpcName, {});

      if (rpcError) {
        setError(rpcError.message);
      } else {
        setResponse(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to call RPC function');
    } finally {
      setLoading(false);
    }
  };

  const updateCardAction = async (cleaningId: string, newAction: string) => {
    setUpdatingCardAction(true);
    try {
      const response = await fetch('/api/update-card-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaningId, action: newAction })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update card action');
      }

      // Update the local state with the complete card data (including recalculated property_clean_status)
      const updatedCard = result.data;
      
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => 
          item.id === cleaningId 
            ? { ...item, ...updatedCard }
            : item
        );
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });

      // Also update the selected card if still open
      setSelectedCard((prev: any) => 
        prev?.id === cleaningId 
          ? { ...prev, ...updatedCard }
          : null
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update card action');
    } finally {
      setUpdatingCardAction(false);
    }
  };

  const updateAssignment = async (cleaningId: string, staffName: string | null) => {
    setAssignmentLoading(true);
    try {
      const response = await fetch('/api/update-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaningId, staffName })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update assignment');
      }

      // Update the local state instead of re-fetching
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => 
          item.id === cleaningId 
            ? { ...item, assigned_staff: staffName }
            : item
        );
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });

      // Update selected card locally to reflect change immediately
      setSelectedCard((prev: any) => ({ ...prev, assigned_staff: staffName }));
      setIsEditingAssignment(false);
      setNewStaffName('');
    } catch (err: any) {
      setError(err.message || 'Failed to update assignment');
    } finally {
      setAssignmentLoading(false);
    }
  };

  const updateTaskAction = async (taskId: string, action: string) => {
    try {
      // Save form data if there's a form open
      if ((window as any).__currentFormSave) {
        await (window as any).__currentFormSave();
      }

      const response = await fetch('/api/update-task-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update task action');
      }

      // Helper to calculate turnover_status from task counts
      const calculateTurnoverStatus = (tasks: any[]) => {
        const total = tasks.length;
        const completed = tasks.filter((t: any) => t.status === 'complete').length;
        const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
        
        if (total === 0) return 'no_tasks';
        if (completed === total) return 'complete';
        if (inProgress > 0 || completed > 0) return 'in_progress';
        return 'not_started';
      };

      // Update the task in selectedCard.tasks array
      setSelectedCard((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        
        const updatedTasks = prev.tasks.map((task: any) => 
          task.task_id === taskId 
            ? { ...task, status: action }
            : task
        );
        
        // Recalculate task counts and turnover_status
        const completedCount = updatedTasks.filter((t: any) => t.status === 'complete').length;
        const inProgressCount = updatedTasks.filter((t: any) => t.status === 'in_progress').length;
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
        
        return { 
          ...prev, 
          tasks: updatedTasks,
          completed_tasks: completedCount,
          tasks_in_progress: inProgressCount,
          turnover_status: newTurnoverStatus
        };
      });

      // Also update the response array (grid view) - only if selectedCard exists (desktop view)
      if (selectedCard) {
        setResponse((prevResponse: any) => {
          if (!prevResponse) return prevResponse;
          
          const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
          const updatedItems = items.map((item: any) => {
            if (item.id === selectedCard.id && item.tasks) {
              const updatedTasks = item.tasks.map((task: any) => 
                task.task_id === taskId 
                  ? { ...task, status: action }
                  : task
              );
              const completedCount = updatedTasks.filter((t: any) => t.status === 'complete').length;
              const inProgressCount = updatedTasks.filter((t: any) => t.status === 'in_progress').length;
              const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
              
              return { 
                ...item, 
                tasks: updatedTasks,
                completed_tasks: completedCount,
                tasks_in_progress: inProgressCount,
                turnover_status: newTurnoverStatus
              };
            }
            return item;
          });
          
          return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update task action');
    }
  };

  const updateTaskAssignment = async (taskId: string, userIds: string[]) => {
    try {
      const response = await fetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userIds })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update task assignment');
      }

      // Build the assigned_users array from the users list
      const assignedUsers = userIds.map(id => {
        const user = users.find(u => u.id === id);
        return user ? { user_id: user.id, name: user.name, avatar: user.avatar, role: user.role } : null;
      }).filter(Boolean);

      // Update the task in selectedCard.tasks array
      setSelectedCard((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        
        const updatedTasks = prev.tasks.map((task: any) => 
          task.task_id === taskId 
            ? { ...task, assigned_users: assignedUsers }
            : task
        );
        
        return { ...prev, tasks: updatedTasks };
      });

      // Also update the response array
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard?.id && item.tasks) {
            const updatedTasks = item.tasks.map((task: any) => 
              task.task_id === taskId 
                ? { ...task, assigned_users: assignedUsers }
                : task
            );
            return { ...item, tasks: updatedTasks };
          }
          return item;
        });
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update task assignment');
    }
  };

  const fetchTaskTemplate = async (templateId: string) => {
    if (taskTemplates[templateId]) {
      return taskTemplates[templateId];
    }

    setLoadingTaskTemplate(templateId);
    try {
      const response = await fetch(`/api/templates/${templateId}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch template');
      }

      setTaskTemplates(prev => ({ ...prev, [templateId]: result.template }));
      return result.template;
    } catch (err: any) {
      console.error('Error fetching template:', err);
      setError(err.message || 'Failed to fetch template');
      return null;
    } finally {
      setLoadingTaskTemplate(null);
    }
  };

  const updateTaskSchedule = async (taskId: string, dateTime: string | null) => {
    try {
      const response = await fetch('/api/update-task-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, scheduledStart: dateTime })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update task schedule');
      }

      // Update the task in selectedCard.tasks array
      setSelectedCard((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        
        const updatedTasks = prev.tasks.map((task: any) => 
          task.task_id === taskId 
            ? { ...task, scheduled_start: dateTime }
            : task
        );
        
        return { ...prev, tasks: updatedTasks };
      });

      // Also update the response array
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard.id && item.tasks) {
            const updatedTasks = item.tasks.map((task: any) => 
              task.task_id === taskId 
                ? { ...task, scheduled_start: dateTime }
                : task
            );
            return { ...item, tasks: updatedTasks };
          }
          return item;
        });
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update task schedule');
    }
  };

  // Use ref to access selectedCard.id without causing re-renders
  const selectedCardIdRef = useRef<string | null>(null);
  selectedCardIdRef.current = selectedCard?.id || null;

  const saveTaskForm = useCallback(async (taskId: string, formData: any) => {
    try {
      const response = await fetch('/api/save-task-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, formData })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save task form');
      }

      // Update the task in selectedCard
      setSelectedCard((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        
        const updatedTasks = prev.tasks.map((task: any) => 
          task.task_id === taskId 
            ? { ...task, form_metadata: formData }
            : task
        );
        
        return { ...prev, tasks: updatedTasks };
      });

      // Also update in response array using ref to get current selectedCard.id
      const currentSelectedCardId = selectedCardIdRef.current;
      if (currentSelectedCardId) {
        setResponse((prevResponse: any) => {
          if (!prevResponse) return prevResponse;
          
          const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
          const updatedItems = items.map((item: any) => {
            if (item.id === currentSelectedCardId && item.tasks) {
              const updatedTasks = item.tasks.map((task: any) => 
                task.task_id === taskId 
                  ? { ...task, form_metadata: formData }
                  : task
              );
              return { ...item, tasks: updatedTasks };
            }
            return item;
          });
          
          return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
        });
      }

      return result;
    } catch (err: any) {
      console.error('Error saving task form:', err);
      setError(err.message || 'Failed to save task form');
      throw err;
    }
  }, []);

  // Fetch available templates for adding tasks
  const fetchAvailableTemplates = async () => {
    try {
      const response = await fetch('/api/tasks');
      const result = await response.json();
      if (response.ok && result.data) {
        setAvailableTemplates(result.data);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  // Helper to calculate turnover_status
  const calculateTurnoverStatus = (tasks: any[]) => {
    const total = tasks.length;
    const completed = tasks.filter((t: any) => t.status === 'complete').length;
    const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
    
    if (total === 0) return 'no_tasks';
    if (completed === total) return 'complete';
    if (inProgress > 0 || completed > 0) return 'in_progress';
    return 'not_started';
  };

  // Add a new task to the current turnover card
  const addTaskToCard = async (templateId: string) => {
    if (!selectedCard) return;
    
    setAddingTask(true);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: selectedCard.id,
          template_id: templateId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to add task');
      }

      const newTask = result.data;

      // Update selectedCard with new task
      setSelectedCard((prev: any) => {
        if (!prev) return prev;
        
        const updatedTasks = [...(prev.tasks || []), newTask];
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
        
        return {
          ...prev,
          tasks: updatedTasks,
          total_tasks: updatedTasks.length,
          completed_tasks: updatedTasks.filter((t: any) => t.status === 'complete').length,
          tasks_in_progress: updatedTasks.filter((t: any) => t.status === 'in_progress').length,
          turnover_status: newTurnoverStatus
        };
      });

      // Update response array (grid view)
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard.id) {
            const updatedTasks = [...(item.tasks || []), newTask];
            const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
            
            return {
              ...item,
              tasks: updatedTasks,
              total_tasks: updatedTasks.length,
              completed_tasks: updatedTasks.filter((t: any) => t.status === 'complete').length,
              tasks_in_progress: updatedTasks.filter((t: any) => t.status === 'in_progress').length,
              turnover_status: newTurnoverStatus
            };
          }
          return item;
        });
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });

      setShowAddTaskDialog(false);
    } catch (err: any) {
      setError(err.message || 'Failed to add task');
    } finally {
      setAddingTask(false);
    }
  };

  // Delete a task from the current turnover card
  const deleteTaskFromCard = async (taskId: string) => {
    if (!selectedCard) return;
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete task');
      }

      // Update selectedCard by removing the task
      setSelectedCard((prev: any) => {
        if (!prev) return prev;
        
        const updatedTasks = (prev.tasks || []).filter((t: any) => t.task_id !== taskId);
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
        
        return {
          ...prev,
          tasks: updatedTasks,
          total_tasks: updatedTasks.length,
          completed_tasks: updatedTasks.filter((t: any) => t.status === 'complete').length,
          tasks_in_progress: updatedTasks.filter((t: any) => t.status === 'in_progress').length,
          turnover_status: newTurnoverStatus
        };
      });

      // Update response array (grid view)
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard.id) {
            const updatedTasks = (item.tasks || []).filter((t: any) => t.task_id !== taskId);
            const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
            
            return {
              ...item,
              tasks: updatedTasks,
              total_tasks: updatedTasks.length,
              completed_tasks: updatedTasks.filter((t: any) => t.status === 'complete').length,
              tasks_in_progress: updatedTasks.filter((t: any) => t.status === 'in_progress').length,
              turnover_status: newTurnoverStatus
            };
          }
          return item;
        });
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });

      // If the deleted task was in fullscreen, close it
      if (fullscreenTask?.task_id === taskId) {
        setFullscreenTask(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete task');
    }
  };

  const saveCleaningForm = async (cleaningId: string, formData: any) => {
    try {
      const response = await fetch('/api/save-cleaning-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaningId, formData })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save form');
      }

      return result;
    } catch (err: any) {
      console.error('Error saving form:', err);
      setError(err.message || 'Failed to save form');
      throw err;
    }
  };

  const openCleaningForm = async () => {
    // If card has a template_id from property default but not saved to cleanings table yet, save it
    if (selectedCard && selectedCard.template_id) {
      try {
        await fetch('/api/update-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cleaningId: selectedCard.id,
            templateId: selectedCard.template_id
          })
        });
      } catch (err) {
        console.error('Error saving template to cleaning:', err);
      }
    }
    setShowCleaningForm(true);
  };

  const changeTemplate = async (templateId: string | null) => {
    if (!selectedCard) return;
    
    try {
      await fetch('/api/update-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaningId: selectedCard.id,
          templateId
        })
      });

      // Update local state
      setSelectedCard({ ...selectedCard, template_id: templateId });
      
      // Refresh to fetch new template
      if (templateId) {
        const res = await fetch(`/api/templates/${templateId}`);
        const data = await res.json();
        if (data.template) {
          setCurrentTemplate(data.template);
        }
      } else {
        setCurrentTemplate(null);
      }
    } catch (err) {
      console.error('Error changing template:', err);
      alert('Failed to change template');
    }
  };

  const getAvailableActions = (currentAction: string) => {
    switch (currentAction) {
      case 'not_started':
      case null:
      case undefined:
        return [
          { value: 'in_progress', label: '▶️ Start', icon: '▶️' },
          { value: 'complete', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'in_progress':
        return [
          { value: 'paused', label: '⏸️ Pause', icon: '⏸️' },
          { value: 'complete', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'paused':
        return [
          { value: 'in_progress', label: '▶️ Resume', icon: '▶️' },
          { value: 'complete', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'complete':
        return [
          { value: 'not_started', label: '↺ Reopen', icon: '↺' }
        ];
      default:
        return [
          { value: 'in_progress', label: '▶️ Start', icon: '▶️' },
          { value: 'complete', label: '✅ Mark Complete', icon: '✅' }
        ];
    }
  };

  const toggleFilter = (category: keyof typeof filters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value]
    }));
  };

  const clearAllFilters = () => {
    setFilters({
      turnoverStatus: [],
      occupancyStatus: [],
      timeline: [],
    });
  };

  const getUniqueStaff = (items: any[]) => {
    const staff = items
      .map(item => item.assigned_staff)
      .filter(s => s !== null && s !== undefined);
    return Array.from(new Set(staff)).sort();
  };

  const getUniqueStaffFromTasks = () => {
    if (!response) return [];
    const items = Array.isArray(response) ? response : [response];
    const allTasks = items.flatMap((item: any) => item.tasks || []);
    const staff = allTasks
      .map((task: any) => task.assigned_staff)
      .filter(s => s !== null && s !== undefined);
    return Array.from(new Set(staff)).sort();
  };

  const getActiveFilterCount = () => {
    return filters.turnoverStatus.length + filters.occupancyStatus.length + filters.timeline.length;
  };
  
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };


  // Timeline manages its own selection internally - no onCardClick prop needed
  const timelineWindowContent = useMemo(() => (
    <Timeline />
  ), []);

  // Group projects by property
  const groupedProjects = useMemo(() => {
    const grouped: { [key: string]: any[] } = {};
    projects.forEach(project => {
      if (!grouped[project.property_name]) {
        grouped[project.property_name] = [];
      }
      grouped[project.property_name].push(project);
    });
    return grouped;
  }, [projects]);

  // Mobile UI
  if (isMobile) {
    return (
      <>
        <MobileLayout
          activeTab={mobileTab}
          onTabChange={setMobileTab}
        >
          {mobileTab === 'assignments' && (
            <MobileMyAssignmentsView
              onTaskClick={async (task: any) => {
                // Fetch template if needed, then open task detail sheet
                if (task.template_id && !taskTemplates[task.template_id]) {
                  await fetchTaskTemplate(task.template_id);
                }
                // Add current user to assigned_users since this task came from My Work (they're assigned)
                setMobileSelectedTask({
                  ...task,
                  assigned_users: [{ user_id: currentUser?.id, name: currentUser?.name }]
                });
              }}
              onProjectClick={(project: any) => {
                // Open project edit dialog
                openEditProjectDialog(project);
              }}
              refreshTrigger={mobileRefreshTrigger}
            />
          )}
          
          {mobileTab === 'timeline' && (
            <MobileTimelineView 
              onCardClick={setSelectedCard}
              refreshTrigger={mobileRefreshTrigger}
              onTaskClick={async (task: any) => {
                // Fetch template if needed, then open task detail
                if (task.template_id && !taskTemplates[task.template_id]) {
                  await fetchTaskTemplate(task.template_id);
                }
                setMobileSelectedTask(task);
              }}
              onProjectClick={(project: any) => {
                // Open project edit dialog
                openEditProjectDialog(project);
              }}
            />
          )}
        </MobileLayout>

        {/* Mobile Task Detail - Full Screen Takeover */}
        {mobileSelectedTask && (
          <div 
            className="fixed inset-0 z-50 bg-white dark:bg-neutral-900 flex flex-col"
            style={{ height: '100dvh' }}
          >
            {/* Header */}
            <div className="shrink-0 px-4 pt-4 pb-3 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">{mobileSelectedTask.template_name || 'Task'}</h2>
                <button 
                  onClick={() => {
                    setMobileSelectedTask(null);
                    setMobileRefreshTrigger(prev => prev + 1);
                  }}
                  className="p-2 -mr-2 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">{mobileSelectedTask.property_name}</span>
                <Badge className={mobileSelectedTask.type === 'maintenance' 
                  ? 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200' 
                  : 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200'
                }>
                  {mobileSelectedTask.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                </Badge>
              </div>
            </div>

            {/* Scrollable Content */}
            <div 
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain hide-scrollbar"
              style={{ 
                overflowAnchor: 'none',
                WebkitOverflowScrolling: 'touch',
                transform: 'translate3d(0,0,0)',
              }}
            >
              <div className="p-4 space-y-4">
                {/* Status Bar */}
                <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Status</p>
                    <Badge className={`${
                      mobileSelectedTask.status === 'complete' 
                        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                        : mobileSelectedTask.status === 'in_progress'
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        : mobileSelectedTask.status === 'paused'
                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                        : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                    }`}>
                      {mobileSelectedTask.status === 'not_started' ? 'Not Started' :
                       mobileSelectedTask.status === 'in_progress' ? 'In Progress' :
                       mobileSelectedTask.status === 'paused' ? 'Paused' :
                       mobileSelectedTask.status === 'complete' ? 'Completed' :
                       'Not Started'}
                    </Badge>
                  </div>
                  {mobileSelectedTask.guest_name && (
                    <div className="text-right">
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Guest</p>
                      <p className="text-sm font-medium">{mobileSelectedTask.guest_name}</p>
                    </div>
                  )}
                </div>

                {/* TASK VIEW - Check assignment first, then status */}
                {!(mobileSelectedTask.assigned_users || []).some((u: any) => u.user_id === currentUser?.id) ? (
                  /* NOT ASSIGNED - Block access to task */
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Button disabled variant="outline">
                      Start Task
                    </Button>
                    <p className="text-sm text-neutral-500">This task hasn't been assigned</p>
                  </div>
                ) : (mobileSelectedTask.status === 'not_started' || !mobileSelectedTask.status) ? (
                  /* ASSIGNED + NOT STARTED - Show Start button */
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Button
                      onClick={() => {
                        updateTaskAction(mobileSelectedTask.task_id, 'in_progress');
                        setMobileSelectedTask({ ...mobileSelectedTask, status: 'in_progress' });
                      }}
                    >
                      Start Task
                    </Button>
                  </div>
                ) : (
                  /* ASSIGNED + ACTIVE - Show form and action buttons */
                  <>
                    {/* Template Form */}
                    {mobileSelectedTask.template_id ? (
                      loadingTaskTemplate === mobileSelectedTask.template_id ? (
                        <div className="flex items-center justify-center py-8">
                          <p className="text-neutral-500">Loading form...</p>
                        </div>
                      ) : taskTemplates[mobileSelectedTask.template_id] ? (
                        <DynamicCleaningForm
                          cleaningId={mobileSelectedTask.task_id}
                          propertyName={mobileSelectedTask.property_name || ''}
                          template={taskTemplates[mobileSelectedTask.template_id]}
                          formMetadata={mobileSelectedTask.form_metadata}
                          onSave={async (formData) => {
                            await saveTaskForm(mobileSelectedTask.task_id, formData);
                          }}
                        />
                      ) : (
                        <p className="text-center text-neutral-500 py-8">
                          No template configured for this task
                        </p>
                      )
                    ) : (
                      <p className="text-center text-neutral-500 py-8">
                        No template configured for this task
                      </p>
                    )}

                    {/* Action Buttons - Only show for active tasks */}
                    <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
                      <div className="flex flex-wrap gap-2">
                        {mobileSelectedTask.status === 'in_progress' && (
                          <>
                            <Button
                              onClick={() => {
                                updateTaskAction(mobileSelectedTask.task_id, 'paused');
                                setMobileSelectedTask({ ...mobileSelectedTask, status: 'paused' });
                              }}
                              variant="outline"
                              className="flex-1"
                            >
                              Pause
                            </Button>
                            <Button
                              onClick={() => {
                                updateTaskAction(mobileSelectedTask.task_id, 'complete');
                                setMobileSelectedTask({ ...mobileSelectedTask, status: 'complete' });
                              }}
                              className="flex-1"
                            >
                              Complete
                            </Button>
                          </>
                        )}
                        {mobileSelectedTask.status === 'paused' && (
                          <>
                            <Button
                              onClick={() => {
                                updateTaskAction(mobileSelectedTask.task_id, 'in_progress');
                                setMobileSelectedTask({ ...mobileSelectedTask, status: 'in_progress' });
                              }}
                              className="flex-1"
                            >
                              Resume
                            </Button>
                            <Button
                              onClick={() => {
                                updateTaskAction(mobileSelectedTask.task_id, 'complete');
                                setMobileSelectedTask({ ...mobileSelectedTask, status: 'complete' });
                              }}
                              variant="outline"
                              className="flex-1"
                            >
                              Complete
                            </Button>
                          </>
                        )}
                        {(mobileSelectedTask.status === 'complete' || mobileSelectedTask.status === 'reopened') && (
                          <Button
                            onClick={() => {
                              updateTaskAction(mobileSelectedTask.task_id, 'not_started');
                              setMobileSelectedTask({ ...mobileSelectedTask, status: 'not_started' });
                            }}
                            className="w-full"
                          >
                            Reopen Task
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Bottom padding for safe area */}
                <div className="h-8" />
              </div>
            </div>
          </div>
        )}

        {/* Mobile Dialogs */}
        {/* Project Dialog */}
        <Dialog open={showProjectDialog} onOpenChange={(open) => {
          if (!open) {
            setShowProjectDialog(false);
            resetProjectForm();
          }
        }}>
          <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProject ? 'Edit Project' : 'Create Project'}</DialogTitle>
              <DialogDescription>
                {editingProject ? 'Update project details' : 'Create a new project for a property'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="block text-sm font-medium mb-2">Property *</label>
                <Select
                  value={projectForm.property_name}
                  onValueChange={(value) => setProjectForm({...projectForm, property_name: value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProperties.map((property) => (
                      <SelectItem key={property} value={property}>{property}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Title *</label>
                <Input
                  value={projectForm.title}
                  onChange={(e) => setProjectForm({...projectForm, title: e.target.value})}
                  placeholder="Project title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <Textarea
                  value={projectForm.description}
                  onChange={(e) => setProjectForm({...projectForm, description: e.target.value})}
                  placeholder="Project description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Status</label>
                  <Select
                    value={projectForm.status}
                    onValueChange={(value) => setProjectForm({...projectForm, status: value})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Not Started</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Priority</label>
                  <Select
                    value={projectForm.priority}
                    onValueChange={(value) => setProjectForm({...projectForm, priority: value})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Assigned Staff</label>
                <Input
                  value={projectForm.assigned_staff}
                  onChange={(e) => setProjectForm({...projectForm, assigned_staff: e.target.value})}
                  placeholder="Staff member name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Due Date</label>
                <Input
                  type="date"
                  value={projectForm.due_date}
                  onChange={(e) => setProjectForm({...projectForm, due_date: e.target.value})}
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setShowProjectDialog(false)} className="w-full sm:w-auto">Cancel</Button>
              <Button onClick={saveProject} disabled={savingProject} className="w-full sm:w-auto">
                {savingProject ? 'Saving...' : (editingProject ? 'Update' : 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ============================================
            ⚠️ MOBILE SECTION - DO NOT MODIFY ⚠️
            Leave this entire mobile section alone.
            Focus development on desktop UI only.
            ============================================ */}
        {/* OLD DIALOG - DISABLED (kept for fallback) */}
        {/* 
        <Dialog open={!!selectedCard} onOpenChange={(open) => {
          if (!open) {
            setSelectedCard(null);
            setShowAddTaskDialog(false);
            setFullscreenTask(null);
            setRightPanelView('tasks');
          }
        }}>
          <DialogContent className={`max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto border-2 ...`}>
            ... Dialog content preserved for reference ...
          </DialogContent>
        </Dialog>
        */}

        {/* SHEET DISABLED - Now using 2-pane layout in FloatingWindow */}
        {false && <Sheet open={!!selectedCard} onOpenChange={(open) => {
          if (!open) {
            setSelectedCard(null);
            setShowAddTaskDialog(false);
            setFullscreenTask(null);
            setRightPanelView('tasks');
          }
        }}>
          <SheetContent 
            side="right" 
            className={`w-full sm:max-w-md overflow-y-auto border-l-2 ${
              selectedCard?.turnover_status === 'not_started' ? 'border-l-red-400' :
              selectedCard?.turnover_status === 'in_progress' ? 'border-l-yellow-400' :
              selectedCard?.turnover_status === 'complete' ? 'border-l-emerald-400' :
              'border-l-neutral-300'
            }`}
          >
            {selectedCard && (
              <>
                {fullscreenTask ? (
                  /* Task Template View - takes over the sheet */
                  <>
                    <SheetHeader>
                      <SheetTitle className="text-xl">
                        {fullscreenTask.template_name || 'Task'}
                      </SheetTitle>
                      <SheetDescription className="flex items-center gap-2">
                        <span>{selectedCard.property_name}</span>
                        <Badge
                          className={fullscreenTask.type === 'maintenance' 
                            ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                            : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                          }
                        >
                          {fullscreenTask.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                        </Badge>
                      </SheetDescription>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto px-4 space-y-4">
                      {/* Task Status Bar */}
                      <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-between">
                        <div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Status</p>
                          <Badge 
                            className={`${
                              fullscreenTask.status === 'complete' 
                                ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                : fullscreenTask.status === 'in_progress'
                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                : fullscreenTask.status === 'paused'
                                ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                            }`}
                          >
                            {fullscreenTask.status === 'not_started' ? 'Not Started' :
                             fullscreenTask.status === 'in_progress' ? 'In Progress' :
                             fullscreenTask.status === 'paused' ? 'Paused' :
                             fullscreenTask.status === 'complete' ? 'Completed' :
                             fullscreenTask.status === 'reopened' ? 'Reopened' :
                             'Not Started'}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Assigned to</p>
                          <p className="text-sm font-medium text-neutral-900 dark:text-white">
                            {fullscreenTask.assigned_staff || 'Unassigned'}
                          </p>
                        </div>
                      </div>

                      {/* TASK VIEW - Check assignment first, then status */}
                      {!(fullscreenTask.assigned_users || []).some((u: any) => u.user_id === currentUser?.id) ? (
                        /* NOT ASSIGNED - Block access to task */
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                          <Button disabled variant="outline">
                            Start Task
                          </Button>
                          <p className="text-sm text-neutral-500">This task hasn't been assigned</p>
                        </div>
                      ) : (fullscreenTask.status === 'not_started' || !fullscreenTask.status) ? (
                        /* ASSIGNED + NOT STARTED - Show Start button */
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                          <Button
                            onClick={() => {
                              updateTaskAction(fullscreenTask.task_id, 'in_progress');
                              setFullscreenTask({ ...fullscreenTask, status: 'in_progress' });
                            }}
                          >
                            Start Task
                          </Button>
                        </div>
                      ) : (
                        /* ASSIGNED + ACTIVE - Show form and action buttons */
                        <>
                          {/* Template Form */}
                          {fullscreenTask.template_id ? (
                            loadingTaskTemplate === fullscreenTask.template_id ? (
                              <div className="flex items-center justify-center py-8">
                                <p className="text-neutral-500">Loading form...</p>
                              </div>
                            ) : taskTemplates[fullscreenTask.template_id] ? (
                              <DynamicCleaningForm
                                cleaningId={fullscreenTask.task_id}
                                propertyName={selectedCard?.property_name || ''}
                                template={taskTemplates[fullscreenTask.template_id]}
                                formMetadata={fullscreenTask.form_metadata}
                                onSave={async (formData) => {
                                  await saveTaskForm(fullscreenTask.task_id, formData);
                                }}
                              />
                            ) : (
                              <p className="text-center text-neutral-500 py-8">
                                No template configured for this task
                              </p>
                            )
                          ) : (
                            <p className="text-center text-neutral-500 py-8">
                              No template configured for this task
                            </p>
                          )}

                          {/* Action Buttons - Only show for active tasks */}
                          <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
                            <div className="flex flex-wrap gap-2">
                              {fullscreenTask.status === 'in_progress' && (
                                <>
                                  <Button
                                    onClick={() => {
                                      updateTaskAction(fullscreenTask.task_id, 'paused');
                                      setFullscreenTask({ ...fullscreenTask, status: 'paused' });
                                    }}
                                    variant="outline"
                                    className="flex-1"
                                  >
                                    Pause
                                  </Button>
                                  <Button
                                    onClick={() => {
                                      updateTaskAction(fullscreenTask.task_id, 'complete');
                                      setFullscreenTask({ ...fullscreenTask, status: 'complete' });
                                    }}
                                    className="flex-1"
                                  >
                                    Complete
                                  </Button>
                                </>
                              )}
                              {fullscreenTask.status === 'paused' && (
                                <>
                                  <Button
                                    onClick={() => {
                                      updateTaskAction(fullscreenTask.task_id, 'in_progress');
                                      setFullscreenTask({ ...fullscreenTask, status: 'in_progress' });
                                    }}
                                    className="flex-1"
                                  >
                                    Resume
                                  </Button>
                                  <Button
                                    onClick={() => {
                                      updateTaskAction(fullscreenTask.task_id, 'complete');
                                      setFullscreenTask({ ...fullscreenTask, status: 'complete' });
                                    }}
                                    variant="outline"
                                    className="flex-1"
                                  >
                                    Complete
                                  </Button>
                                </>
                              )}
                              {(fullscreenTask.status === 'complete' || fullscreenTask.status === 'reopened') && (
                                <Button
                                  onClick={() => {
                                    updateTaskAction(fullscreenTask.task_id, 'not_started');
                                    setFullscreenTask({ ...fullscreenTask, status: 'not_started' });
                                  }}
                                  className="w-full"
                                >
                                  Reopen Task
                                </Button>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <SheetFooter className="border-t pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setFullscreenTask(null)}
                        className="w-full"
                      >
                        Back
                      </Button>
                    </SheetFooter>
                  </>
                ) : (
                  /* Turnover Card Content - normal view */
                  <>
                    <SheetHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <SheetTitle className="text-xl">
                            {selectedCard.title || selectedCard.property_name || 'Unknown'}
                          </SheetTitle>
                          <SheetDescription className="flex items-center gap-2 text-base">
                            {selectedCard.guest_name ? (
                              <>
                                <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                {selectedCard.guest_name}
                              </>
                            ) : (
                              <span className="text-neutral-600 dark:text-neutral-400">
                                {selectedCard.description || 'No description'}
                              </span>
                            )}
                          </SheetDescription>
                        </div>
                      </div>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto px-4 space-y-4">
                      {/* Dates */}
                      <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                          <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Checked out</div>
                            <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                              {selectedCard.check_out ? formatDate(selectedCard.check_out) : 'Not set'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                          <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                          </svg>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Next check in</div>
                            <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                              {selectedCard.next_check_in ? formatDate(selectedCard.next_check_in) : 'Not set'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                          <svg className={`w-5 h-5 shrink-0 ${
                            selectedCard.occupancy_status === 'occupied' ? 'text-orange-500' : 
                            selectedCard.occupancy_status === 'general' ? 'text-neutral-400' : 
                            'text-neutral-400'
                          }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                          </svg>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Occupancy</div>
                            <Badge 
                              variant={selectedCard.occupancy_status === 'occupied' ? 'default' : 'outline'}
                              className={`px-3 py-1 ${
                                selectedCard.occupancy_status === 'occupied' 
                                  ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                                  : selectedCard.occupancy_status === 'general'
                                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300'
                                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300'
                              }`}
                            >
                              {selectedCard.occupancy_status === 'occupied' ? 'Occupied' : 
                               selectedCard.occupancy_status === 'general' ? 'General' : 
                               'Vacant'}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {/* Tasks Section */}
                      {selectedCard.tasks && selectedCard.tasks.length > 0 ? (
                        <div className="space-y-3 mt-6">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
                              Tasks ({selectedCard.completed_tasks || 0}/{selectedCard.total_tasks || 0})
                            </h3>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400">
                              Click a task to open
                            </div>
                          </div>

                          <div className="space-y-3">
                            {selectedCard.tasks.map((task: any) => {
                              const assignedUserIds = (task.assigned_users || []).map((u: any) => u.user_id);
                              const taskStatus = task.status || 'not_started';
                              
                              // Color scheme based on status
                              const getStatusStyles = (status: string) => {
                                switch (status) {
                                  case 'complete':
                                    return {
                                      border: 'border',
                                      badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                    };
                                  case 'in_progress':
                                    return {
                                      border: 'border',
                                      badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800'
                                    };
                                  case 'paused':
                                    return {
                                      border: 'border',
                                      badge: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
                                    };
                                  default: // not_started, reopened
                                    return {
                                      border: 'border',
                                      badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                                    };
                                }
                              };
                              
                              const statusStyles = getStatusStyles(taskStatus);
                              
                              return (
                                <Card 
                                  key={task.task_id}
                                  className={`cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 ${statusStyles.border}`}
                                  onClick={async (e) => {
                                    if ((e.target as HTMLElement).closest('button, [data-radix-popper-content-wrapper]')) return;
                                    if (task.template_id && !taskTemplates[task.template_id]) {
                                      await fetchTaskTemplate(task.template_id);
                                    }
                                    setFullscreenTask(task);
                                  }}
                                >
                                  <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-base">
                                        {task.template_name || 'Unnamed Task'}
                                      </CardTitle>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('Remove this task from the turnover?')) {
                                              deleteTaskFromCard(task.task_id);
                                            }
                                          }}
                                        >
                                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </Button>
                                      </div>
                                    </div>
                                    
                                    {/* Status & Type Badges */}
                                    <div className="flex items-center gap-2 mt-2">
                                      <Badge className={`px-2 py-0.5 text-xs border ${statusStyles.badge}`}>
                                        {taskStatus === 'complete' ? 'Complete' :
                                         taskStatus === 'in_progress' ? 'In Progress' :
                                         taskStatus === 'paused' ? 'Paused' :
                                         taskStatus === 'reopened' ? 'Reopened' :
                                         'Not Started'}
                                      </Badge>
                                      <Badge
                                        className={`px-2 py-0.5 text-xs border ${task.type === 'maintenance' 
                                          ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                          : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                                        }`}
                                      >
                                        {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                      </Badge>
                                    </div>
                                    
                                    {/* Schedule & Assignment Row */}
                                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-700">
                                      {/* Date/Time Picker */}
                                      <div className="flex items-center gap-2">
                                        <Popover>
                                          <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                                              {task.scheduled_start 
                                                ? new Date(task.scheduled_start).toLocaleDateString() 
                                                : 'Date'}
                                            </Button>
                                          </PopoverTrigger>
                                          <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                                            <Calendar
                                              mode="single"
                                              selected={task.scheduled_start ? new Date(task.scheduled_start) : undefined}
                                              onSelect={(date) => {
                                                if (date) {
                                                  const existingDate = task.scheduled_start ? new Date(task.scheduled_start) : null;
                                                  if (existingDate) {
                                                    date.setHours(existingDate.getHours(), existingDate.getMinutes());
                                                  } else {
                                                    date.setHours(12, 0);
                                                  }
                                                  updateTaskSchedule(task.task_id, date.toISOString());
                                                }
                                              }}
                                            />
                                          </PopoverContent>
                                        </Popover>
                                        <input
                                          type="time"
                                          className="h-7 px-2 text-xs border rounded-md bg-background dark:bg-neutral-800 dark:border-neutral-700"
                                          value={task.scheduled_start 
                                            ? new Date(task.scheduled_start).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
                                            : ''
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            const [hours, minutes] = e.target.value.split(':').map(Number);
                                            const date = task.scheduled_start ? new Date(task.scheduled_start) : new Date();
                                            date.setHours(hours, minutes);
                                            updateTaskSchedule(task.task_id, date.toISOString());
                                          }}
                                        />
                                      </div>
                                      
                                      {/* Assignment Dropdown */}
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                                            {assignedUserIds.length > 0 ? (
                                              <span className="flex items-center gap-1">
                                                {(task.assigned_users || []).slice(0, 2).map((u: any) => (
                                                  <span key={u.user_id} title={u.name}>{u.avatar || '👤'}</span>
                                                ))}
                                                {assignedUserIds.length > 2 && <span className="text-neutral-500">+{assignedUserIds.length - 2}</span>}
                                              </span>
                                            ) : (
                                              <span className="text-neutral-400">Assign</span>
                                            )}
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                          <DropdownMenuLabel>Assign Users</DropdownMenuLabel>
                                          <DropdownMenuSeparator />
                                          {users.map((user) => (
                                            <DropdownMenuCheckboxItem
                                              key={user.id}
                                              checked={assignedUserIds.includes(user.id)}
                                              onCheckedChange={(checked) => {
                                                const newIds = checked
                                                  ? [...assignedUserIds, user.id]
                                                  : assignedUserIds.filter((id: string) => id !== user.id);
                                                updateTaskAssignment(task.task_id, newIds);
                                              }}
                                            >
                                              <span className="mr-2">{user.avatar}</span>
                                              {user.name}
                                              <span className="ml-auto text-xs text-neutral-400">{user.role}</span>
                                            </DropdownMenuCheckboxItem>
                                          ))}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </CardHeader>
                                </Card>
                              );
                            })}
                          </div>

                          {/* Add Task Button */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-3"
                            onClick={() => {
                              fetchAvailableTemplates();
                              setShowAddTaskDialog(true);
                            }}
                          >
                            Add Task
                          </Button>

                          {/* Add Task Panel */}
                          {showAddTaskDialog && (
                            <div className="mt-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-medium text-neutral-900 dark:text-white">Select a Template</h4>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => setShowAddTaskDialog(false)}
                                >
                                  ✕
                                </Button>
                              </div>
                              
                              {availableTemplates.length > 0 ? (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {availableTemplates
                                    .filter(template => 
                                      !selectedCard.tasks?.some((t: any) => t.template_id === template.id)
                                    )
                                    .map((template) => (
                                      <Button
                                        key={template.id}
                                        variant="ghost"
                                        size="sm"
                                        className="w-full justify-start"
                                        disabled={addingTask}
                                        onClick={() => addTaskToCard(template.id)}
                                      >
                                        <Badge 
                                          variant="outline" 
                                          className={`mr-2 ${
                                            template.type === 'maintenance' 
                                              ? 'bg-orange-100 text-orange-800 border-orange-300' 
                                              : 'bg-blue-100 text-blue-800 border-blue-300'
                                          }`}
                                        >
                                          {template.type === 'cleaning' ? 'C' : 'M'}
                                        </Badge>
                                        {template.name}
                                      </Button>
                                    ))}
                                  {availableTemplates.filter(t => 
                                    !selectedCard.tasks?.some((task: any) => task.template_id === t.id)
                                  ).length === 0 && (
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                      All templates already assigned
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                  Loading templates...
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-6 p-6 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 text-center">
                          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                            No tasks configured for this property.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              fetchAvailableTemplates();
                              setShowAddTaskDialog(true);
                            }}
                          >
                            Add Task
                          </Button>
                          
                          {/* Add Task Panel (when no tasks exist) */}
                          {showAddTaskDialog && (
                            <div className="mt-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-left">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-medium text-neutral-900 dark:text-white">Select a Template</h4>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => setShowAddTaskDialog(false)}
                                >
                                  ✕
                                </Button>
                              </div>
                              
                              {availableTemplates.length > 0 ? (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {availableTemplates.map((template) => (
                                    <Button
                                      key={template.id}
                                      variant="ghost"
                                      size="sm"
                                      className="w-full justify-start"
                                      disabled={addingTask}
                                      onClick={() => addTaskToCard(template.id)}
                                    >
                                      <Badge 
                                        variant="outline" 
                                        className={`mr-2 ${
                                          template.type === 'maintenance' 
                                            ? 'bg-orange-100 text-orange-800 border-orange-300' 
                                            : 'bg-blue-100 text-blue-800 border-blue-300'
                                        }`}
                                      >
                                        {template.type === 'cleaning' ? 'C' : 'M'}
                                      </Badge>
                                      {template.name}
                                    </Button>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                  Loading templates...
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Property Projects Section */}
                      {selectedCard.property_name && (
                        <div className="mt-6 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
                          {/* Collapsible Header */}
                          <button
                            onClick={() => setRightPanelView(rightPanelView === 'projects' ? 'tasks' : 'projects')}
                            className="w-full flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                              </svg>
                              <span className="font-semibold text-neutral-900 dark:text-white">
                                Property Projects
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {projects.filter(p => p.property_name === selectedCard.property_name).length}
                              </Badge>
                            </div>
                            <svg 
                              className={`w-5 h-5 text-neutral-500 transition-transform duration-200 ${rightPanelView === 'projects' ? 'rotate-180' : ''}`} 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {/* Expandable Content */}
                          {rightPanelView === 'projects' && (
                            <div className="p-4 space-y-3 bg-white dark:bg-neutral-900">
                              {projects.filter(p => p.property_name === selectedCard.property_name).length > 0 ? (
                                projects
                                  .filter(p => p.property_name === selectedCard.property_name)
                                  .map((project: any) => (
                                    <div 
                                      key={project.id}
                                      className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <h4 className="font-medium text-sm text-neutral-900 dark:text-white truncate">
                                            {project.title}
                                          </h4>
                                          {project.description && (
                                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                                              {project.description}
                                            </p>
                                          )}
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                          <Badge 
                                            className={`text-xs ${
                                              project.status === 'complete' 
                                                ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                                                : project.status === 'in_progress'
                                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                                                : project.status === 'on_hold'
                                                ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
                                                : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                                            }`}
                                          >
                                            {project.status?.replace('_', ' ') || 'not started'}
                                          </Badge>
                                          <Badge 
                                            className={`text-xs ${
                                              project.priority === 'urgent' 
                                                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                                                : project.priority === 'high'
                                                ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                                                : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                                            }`}
                                          >
                                            {project.priority || 'medium'}
                                          </Badge>
                                        </div>
                                      </div>
                                      {/* Footer with staff and due date */}
                                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
                                        <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                          </svg>
                                          <span>{project.assigned_staff || 'Unassigned'}</span>
                                        </div>
                                        {project.due_date && (
                                          <div className={`flex items-center gap-1 text-xs ${
                                            new Date(project.due_date) < new Date() 
                                              ? 'text-red-500' 
                                              : new Date(project.due_date) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                                              ? 'text-orange-500'
                                              : 'text-neutral-500 dark:text-neutral-400'
                                          }`}>
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                            <span>{new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))
                              ) : null}
                              
                              {/* Create Project Button - always visible */}
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => openCreateProjectDialog(selectedCard.property_name)}
                              >
                                Create Project
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <SheetFooter className="border-t pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedCard(null)}
                        className="w-full"
                      >
                        Close
                      </Button>
                    </SheetFooter>
                  </>
                )}
              </>
            )}
          </SheetContent>
        </Sheet>}

      </>
    );
  }

  // Desktop UI
  return (
    <div className="flex h-screen bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      <Sidebar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fixed Header */}
        <div className="flex-shrink-0 p-4 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
              Property Management Dashboard
            </h1>
            
            {/* Window Controls */}
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (showCardsWindow) {
                    setShowCardsWindow(false);
                  } else {
                    setShowCardsWindow(true);
                    bringToFront('cards');
                  }
                }}
                variant="secondary"
                size="sm"
                className="px-4 py-2"
              >
                Turnovers
              </Button>
              <Button
                onClick={() => {
                  if (showTimelineWindow) {
                    setShowTimelineWindow(false);
                  } else {
                    setShowTimelineWindow(true);
                    bringToFront('timeline');
                  }
                }}
                variant="secondary"
                size="sm"
                className="px-4 py-2"
              >
                Timeline
              </Button>
              <Button
                onClick={() => {
                  if (showProjectsWindow) {
                    setShowProjectsWindow(false);
                  } else {
                    setShowProjectsWindow(true);
                    bringToFront('projects');
                  }
                }}
                variant="secondary"
                size="sm"
                className="px-4 py-2"
              >
                Projects
              </Button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-medium text-red-800 dark:text-red-400">Error:</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Floating Windows Container */}
        <div 
          className="flex-1 relative overflow-hidden bg-background"
        >
          {/* Turnovers Window */}
          {showCardsWindow && (
            <FloatingWindow
              id="cards"
              title="Turnovers"
              defaultPosition={{ x: 50, y: 50 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('cards')}
              onClose={() => setShowCardsWindow(false)}
              onFocus={() => bringToFront('cards')}
            >
              <TurnoversWindow
                users={users}
                currentUser={currentUser}
                projects={projects}
                setProjects={setProjects}
                onOpenProjectInWindow={(project) => {
                  setExpandedProject(project);
                  setEditingProjectFields({
                    title: project.title,
                    description: project.description || '',
                    status: project.status,
                    priority: project.priority,
                    assigned_staff: project.project_assignments?.[0]?.user_id || '',
                    due_date: project.due_date || ''
                  });
                  setShowProjectsWindow(true);
                  bringToFront('projects');
                }}
                onCreateProject={(propertyName) => openCreateProjectDialog(propertyName)}
              />
            </FloatingWindow>
          )}

          {/* Timeline Window */}
          {showTimelineWindow && (
            <FloatingWindow
              id="timeline"
              title="Timeline View"
              defaultPosition={{ x: 150, y: 150 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('timeline')}
              onClose={() => setShowTimelineWindow(false)}
              onFocus={() => bringToFront('timeline')}
            >
              {timelineWindowContent}
            </FloatingWindow>
          )}

          {/* Projects Window */}
          {showProjectsWindow && (
            <FloatingWindow
              id="projects"
              title="Property Projects"
              defaultPosition={{ x: 300, y: 100 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('projects')}
              onClose={() => setShowProjectsWindow(false)}
              onFocus={() => bringToFront('projects')}
            >
              <ProjectsWindow users={users} currentUser={currentUser} />
            </FloatingWindow>
          )}


          {/* AI Chat */}
          <AiChat />
        </div>
      </div>

      {/* ============================================
          DESKTOP: Turnover Card Detail Sheet
          DISABLED - Now using 2-pane layout in FloatingWindow
          ============================================ */}
      {false && <Sheet open={!!selectedCard} onOpenChange={(open) => {
        if (!open) {
          setSelectedCard(null);
          setShowAddTaskDialog(false);
          setFullscreenTask(null);
          setRightPanelView('tasks');
        }
      }}>
        <SheetContent
          side="right"
          className={`w-full sm:max-w-md overflow-y-auto border-l-2 ${
            selectedCard?.turnover_status === 'not_started' ? 'border-l-red-400' :
            selectedCard?.turnover_status === 'in_progress' ? 'border-l-yellow-400' :
            selectedCard?.turnover_status === 'complete' ? 'border-l-emerald-400' :
            'border-l-neutral-300'
          }`}
        >
          {selectedCard && (
            <>
              {fullscreenTask ? (
                /* Task Template View - takes over the sheet */
                <>
                  <SheetHeader>
                    <SheetTitle className="text-xl">
                      {fullscreenTask.template_name || 'Task'}
                    </SheetTitle>
                    <SheetDescription className="flex items-center gap-2">
                      <span>{selectedCard.property_name}</span>
                      <Badge
                        className={fullscreenTask.type === 'maintenance' 
                          ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                          : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        }
                      >
                        {fullscreenTask.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                      </Badge>
                    </SheetDescription>
                  </SheetHeader>

                  <div className="flex-1 overflow-y-auto space-y-4">
                    {/* Task Status Bar */}
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Status</p>
                        <Badge 
                          className={`${
                            fullscreenTask.status === 'complete' 
                              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                              : fullscreenTask.status === 'in_progress'
                              ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                              : fullscreenTask.status === 'paused'
                              ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                              : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          {fullscreenTask.status === 'not_started' ? 'Not Started' :
                           fullscreenTask.status === 'in_progress' ? 'In Progress' :
                           fullscreenTask.status === 'paused' ? 'Paused' :
                           fullscreenTask.status === 'complete' ? 'Completed' :
                           fullscreenTask.status === 'reopened' ? 'Reopened' :
                           'Not Started'}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Assigned to</p>
                        <p className="text-sm font-medium text-neutral-900 dark:text-white">
                          {fullscreenTask.assigned_staff || 'Unassigned'}
                        </p>
                      </div>
                    </div>

                    {/* TASK VIEW - Check assignment first, then status */}
                    {!(fullscreenTask.assigned_users || []).some((u: any) => u.user_id === currentUser?.id) ? (
                      /* NOT ASSIGNED - Block access to task */
                      <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <Button disabled variant="outline">
                          Start Task
                        </Button>
                        <p className="text-sm text-neutral-500">This task hasn't been assigned</p>
                      </div>
                    ) : (fullscreenTask.status === 'not_started' || !fullscreenTask.status) ? (
                      /* ASSIGNED + NOT STARTED - Show Start button */
                      <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <Button
                          onClick={() => {
                            updateTaskAction(fullscreenTask.task_id, 'in_progress');
                            setFullscreenTask({ ...fullscreenTask, status: 'in_progress' });
                          }}
                        >
                          Start Task
                        </Button>
                      </div>
                    ) : (
                      /* ASSIGNED + ACTIVE - Show form and action buttons */
                      <>
                        {/* Template Form */}
                        {fullscreenTask.template_id ? (
                          loadingTaskTemplate === fullscreenTask.template_id ? (
                            <div className="flex items-center justify-center py-8">
                              <p className="text-neutral-500">Loading form...</p>
                            </div>
                          ) : taskTemplates[fullscreenTask.template_id] ? (
                            <DynamicCleaningForm
                              cleaningId={fullscreenTask.task_id}
                              propertyName={selectedCard?.property_name || ''}
                              template={taskTemplates[fullscreenTask.template_id]}
                              formMetadata={fullscreenTask.form_metadata}
                              onSave={async (formData) => {
                                await saveTaskForm(fullscreenTask.task_id, formData);
                              }}
                            />
                          ) : (
                            <p className="text-center text-neutral-500 py-8">
                              No template configured for this task
                            </p>
                          )
                        ) : (
                          <p className="text-center text-neutral-500 py-8">
                            No template configured for this task
                          </p>
                        )}

                        {/* Action Buttons - Only show for active tasks */}
                        <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
                          <div className="flex flex-wrap gap-2">
                            {fullscreenTask.status === 'in_progress' && (
                              <>
                                <Button
                                  onClick={() => {
                                    updateTaskAction(fullscreenTask.task_id, 'paused');
                                    setFullscreenTask({ ...fullscreenTask, status: 'paused' });
                                  }}
                                  variant="outline"
                                  className="flex-1"
                                >
                                  Pause
                                </Button>
                                <Button
                                  onClick={() => {
                                    updateTaskAction(fullscreenTask.task_id, 'complete');
                                    setFullscreenTask({ ...fullscreenTask, status: 'complete' });
                                  }}
                                  className="flex-1"
                                >
                                  Complete
                                </Button>
                              </>
                            )}
                            {fullscreenTask.status === 'paused' && (
                              <>
                                <Button
                                  onClick={() => {
                                    updateTaskAction(fullscreenTask.task_id, 'in_progress');
                                    setFullscreenTask({ ...fullscreenTask, status: 'in_progress' });
                                  }}
                                  className="flex-1"
                                >
                                  Resume
                                </Button>
                                <Button
                                  onClick={() => {
                                    updateTaskAction(fullscreenTask.task_id, 'complete');
                                    setFullscreenTask({ ...fullscreenTask, status: 'complete' });
                                  }}
                                  variant="outline"
                                  className="flex-1"
                                >
                                  Complete
                                </Button>
                              </>
                            )}
                            {(fullscreenTask.status === 'complete' || fullscreenTask.status === 'reopened') && (
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'not_started');
                                  setFullscreenTask({ ...fullscreenTask, status: 'not_started' });
                                }}
                                className="w-full"
                              >
                                Reopen Task
                              </Button>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <SheetFooter>
                    <Button
                      variant="outline"
                      onClick={() => setFullscreenTask(null)}
                      className="w-full"
                    >
                      Back
                    </Button>
                  </SheetFooter>
                </>
              ) : (
                /* Turnover Card Content - normal view */
                <>
                  <SheetHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <SheetTitle className="text-2xl">
                          {selectedCard.title || selectedCard.property_name || 'Unknown'}
                        </SheetTitle>
                        <SheetDescription className="text-base">
                          {/* Show guest name for cleanings, description for maintenance */}
                          {selectedCard.guest_name ? (
                            <span>{selectedCard.guest_name}</span>
                          ) : (
                            <span className="text-neutral-600 dark:text-neutral-400">
                              {selectedCard.description || 'No description'}
                            </span>
                          )}
                        </SheetDescription>
                      </div>
                    </div>
                  </SheetHeader>

                  <div className="flex-1 overflow-y-auto space-y-4">
                    {/* Dates & Occupancy */}
                    <div className="grid grid-cols-1 gap-4">
                      {/* Checked Out */}
                      <div>
                        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">Checked out</div>
                        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                          <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                            {selectedCard.check_out ? formatDate(selectedCard.check_out) : 'Not set'}
                          </div>
                        </div>
                      </div>

                      {/* Next Check In */}
                      <div>
                        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">Next check in</div>
                        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                          <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                            {selectedCard.next_check_in ? formatDate(selectedCard.next_check_in) : 'Not set'}
                          </div>
                        </div>
                      </div>

                      {/* Occupancy */}
                      <div>
                        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">Occupancy</div>
                        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                          <Badge 
                            variant={selectedCard.occupancy_status === 'occupied' ? 'default' : 'outline'}
                            className={`px-3 py-1 ${
                              selectedCard.occupancy_status === 'occupied' 
                                ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                                : selectedCard.occupancy_status === 'general'
                                ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300'
                                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300'
                            }`}
                          >
                            {selectedCard.occupancy_status === 'occupied' ? 'Occupied' : 
                             selectedCard.occupancy_status === 'general' ? 'General' : 
                             'Vacant'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Tasks Section */}
                    {selectedCard.tasks && selectedCard.tasks.length > 0 ? (
                      <div className="space-y-3 mt-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
                            Tasks ({selectedCard.completed_tasks || 0}/{selectedCard.total_tasks || 0})
                          </h3>
                          <div className="text-xs text-neutral-500 dark:text-neutral-400">
                            Click a task to open
                          </div>
                        </div>

                        <div className="space-y-3">
                          {selectedCard.tasks.map((task: any) => {
                            const assignedUserIds = (task.assigned_users || []).map((u: any) => u.user_id);
                            const taskStatus = task.status || 'not_started';
                            
                            // Color scheme based on status
                            const getStatusStyles = (status: string) => {
                              switch (status) {
                                case 'complete':
                                  return {
                                    border: 'border',
                                    badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                  };
                                case 'in_progress':
                                  return {
                                    border: 'border',
                                    badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800'
                                  };
                                case 'paused':
                                  return {
                                    border: 'border',
                                    badge: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
                                  };
                                default: // not_started, reopened
                                  return {
                                    border: 'border',
                                    badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                                  };
                              }
                            };
                            
                            const statusStyles = getStatusStyles(taskStatus);
                            
                            return (
                              <Card 
                                key={task.task_id}
                                className={`cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 ${statusStyles.border}`}
                                onClick={async (e) => {
                                  if ((e.target as HTMLElement).closest('button, [data-radix-popper-content-wrapper]')) return;
                                  if (task.template_id && !taskTemplates[task.template_id]) {
                                    await fetchTaskTemplate(task.template_id);
                                  }
                                  setFullscreenTask(task);
                                }}
                              >
                                <CardHeader className="pb-3">
                                  <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">
                                      {task.template_name || 'Unnamed Task'}
                                    </CardTitle>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (confirm('Remove this task from the turnover?')) {
                                            deleteTaskFromCard(task.task_id);
                                          }
                                        }}
                                      >
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      </Button>
                                    </div>
                                  </div>
                                  
                                  {/* Status & Type Badges */}
                                  <div className="flex items-center gap-2 mt-2">
                                    <Badge className={`px-2 py-0.5 text-xs border ${statusStyles.badge}`}>
                                      {taskStatus === 'complete' ? 'Complete' :
                                       taskStatus === 'in_progress' ? 'In Progress' :
                                       taskStatus === 'paused' ? 'Paused' :
                                       taskStatus === 'reopened' ? 'Reopened' :
                                       'Not Started'}
                                    </Badge>
                                    <Badge
                                      className={`px-2 py-0.5 text-xs border ${task.type === 'maintenance' 
                                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                        : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                                      }`}
                                    >
                                      {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                    </Badge>
                                  </div>
                                  
                                  {/* Schedule & Assignment Row */}
                                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-700">
                                    {/* Date/Time Picker */}
                                    <div className="flex items-center gap-2">
                                      <Popover>
                                        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                                            {task.scheduled_start 
                                              ? new Date(task.scheduled_start).toLocaleDateString() 
                                              : 'Date'}
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                                          <Calendar
                                            mode="single"
                                            selected={task.scheduled_start ? new Date(task.scheduled_start) : undefined}
                                            onSelect={(date) => {
                                              if (date) {
                                                const existingDate = task.scheduled_start ? new Date(task.scheduled_start) : null;
                                                if (existingDate) {
                                                  date.setHours(existingDate.getHours(), existingDate.getMinutes());
                                                } else {
                                                  date.setHours(12, 0);
                                                }
                                                updateTaskSchedule(task.task_id, date.toISOString());
                                              }
                                            }}
                                          />
                                        </PopoverContent>
                                      </Popover>
                                      <input
                                        type="time"
                                        className="h-7 px-2 text-xs border rounded-md bg-background dark:bg-neutral-800 dark:border-neutral-700"
                                        value={task.scheduled_start 
                                          ? new Date(task.scheduled_start).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
                                          : ''
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          const [hours, minutes] = e.target.value.split(':').map(Number);
                                          const date = task.scheduled_start ? new Date(task.scheduled_start) : new Date();
                                          date.setHours(hours, minutes);
                                          updateTaskSchedule(task.task_id, date.toISOString());
                                        }}
                                      />
                                    </div>
                                    
                                    {/* Assignment Dropdown */}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                                          {assignedUserIds.length > 0 ? (
                                            <span className="flex items-center gap-1">
                                              {(task.assigned_users || []).slice(0, 2).map((u: any) => (
                                                <span key={u.user_id} title={u.name}>{u.avatar || '👤'}</span>
                                              ))}
                                              {assignedUserIds.length > 2 && <span className="text-neutral-500">+{assignedUserIds.length - 2}</span>}
                                            </span>
                                          ) : (
                                            <span className="text-neutral-400">Assign</span>
                                          )}
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                        <DropdownMenuLabel>Assign Users</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {users.map((user) => (
                                          <DropdownMenuCheckboxItem
                                            key={user.id}
                                            checked={assignedUserIds.includes(user.id)}
                                            onCheckedChange={(checked) => {
                                              const newIds = checked
                                                ? [...assignedUserIds, user.id]
                                                : assignedUserIds.filter((id: string) => id !== user.id);
                                              updateTaskAssignment(task.task_id, newIds);
                                            }}
                                          >
                                            <span className="mr-2">{user.avatar}</span>
                                            {user.name}
                                            <span className="ml-auto text-xs text-neutral-400">{user.role}</span>
                                          </DropdownMenuCheckboxItem>
                                        ))}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </CardHeader>
                              </Card>
                            );
                          })}
                        </div>

                        {/* Add Task Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-3"
                          onClick={() => {
                            fetchAvailableTemplates();
                            setShowAddTaskDialog(true);
                          }}
                        >
                          Add Task
                        </Button>

                        {/* Add Task Panel */}
                        {showAddTaskDialog && (
                          <div className="mt-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-medium text-neutral-900 dark:text-white">Select a Template</h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setShowAddTaskDialog(false)}
                              >
                                ✕
                              </Button>
                            </div>
                            
                            {availableTemplates.length > 0 ? (
                              <div className="space-y-2 max-h-48 overflow-y-auto">
                                {availableTemplates
                                  .filter(template => 
                                    // Filter out templates already assigned to this card
                                    !selectedCard.tasks?.some((t: any) => t.template_id === template.id)
                                  )
                                  .map((template) => (
                                    <Button
                                      key={template.id}
                                      variant="ghost"
                                      size="sm"
                                      className="w-full justify-start"
                                      disabled={addingTask}
                                      onClick={() => addTaskToCard(template.id)}
                                    >
                                      <Badge 
                                        variant="outline" 
                                        className={`mr-2 ${
                                          template.type === 'maintenance' 
                                            ? 'bg-orange-100 text-orange-800 border-orange-300' 
                                            : 'bg-blue-100 text-blue-800 border-blue-300'
                                        }`}
                                      >
                                        {template.type === 'cleaning' ? 'C' : 'M'}
                                      </Badge>
                                      {template.name}
                                    </Button>
                                  ))}
                                {availableTemplates.filter(t => 
                                  !selectedCard.tasks?.some((task: any) => task.template_id === t.id)
                                ).length === 0 && (
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                    All templates already assigned
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                Loading templates...
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-6 p-6 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 text-center">
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                          No tasks configured for this property.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            fetchAvailableTemplates();
                            setShowAddTaskDialog(true);
                          }}
                        >
                          Add Task
                        </Button>
                        
                        {/* Add Task Panel (when no tasks exist) */}
                        {showAddTaskDialog && (
                          <div className="mt-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-left">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-medium text-neutral-900 dark:text-white">Select a Template</h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setShowAddTaskDialog(false)}
                              >
                                ✕
                              </Button>
                            </div>
                            
                            {availableTemplates.length > 0 ? (
                              <div className="space-y-2 max-h-48 overflow-y-auto">
                                {availableTemplates.map((template) => (
                                  <Button
                                    key={template.id}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start"
                                    disabled={addingTask}
                                    onClick={() => addTaskToCard(template.id)}
                                  >
                                    <Badge 
                                      variant="outline" 
                                      className={`mr-2 ${
                                        template.type === 'maintenance' 
                                          ? 'bg-orange-100 text-orange-800 border-orange-300' 
                                          : 'bg-blue-100 text-blue-800 border-blue-300'
                                      }`}
                                    >
                                      {template.type === 'cleaning' ? 'C' : 'M'}
                                    </Badge>
                                    {template.name}
                                  </Button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                Loading templates...
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Property Projects Section */}
                    {selectedCard.property_name && (
                      <div className="mt-6 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
                        {/* Collapsible Header */}
                        <button
                          onClick={() => setRightPanelView(rightPanelView === 'projects' ? 'tasks' : 'projects')}
                          className="w-full flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            <span className="font-semibold text-neutral-900 dark:text-white">
                              Property Projects
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {projects.filter(p => p.property_name === selectedCard.property_name).length}
                            </Badge>
                          </div>
                          <svg 
                            className={`w-5 h-5 text-neutral-500 transition-transform duration-200 ${rightPanelView === 'projects' ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* Expandable Content */}
                        {rightPanelView === 'projects' && (
                          <div className="p-4 space-y-3 bg-white dark:bg-neutral-900">
                            {projects.filter(p => p.property_name === selectedCard.property_name).length > 0 ? (
                              projects
                                .filter(p => p.property_name === selectedCard.property_name)
                                .map((project: any) => (
                                  <div 
                                    key={project.id}
                                    className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <h4 className="font-medium text-sm text-neutral-900 dark:text-white truncate">
                                          {project.title}
                                        </h4>
                                        {project.description && (
                                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                                            {project.description}
                                          </p>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-end gap-1 shrink-0">
                                        <Badge 
                                          className={`text-xs ${
                                            project.status === 'complete' 
                                              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                                              : project.status === 'in_progress'
                                              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                                              : project.status === 'on_hold'
                                              ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
                                              : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                                          }`}
                                        >
                                          {project.status?.replace('_', ' ') || 'not started'}
                                        </Badge>
                                        <Badge 
                                          className={`text-xs ${
                                            project.priority === 'urgent' 
                                              ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                                              : project.priority === 'high'
                                              ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                                              : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                                          }`}
                                        >
                                          {project.priority || 'medium'}
                                        </Badge>
                                      </div>
                                    </div>
                                    {/* Footer with staff and due date */}
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
                                      <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                        <span>{project.assigned_staff || 'Unassigned'}</span>
                                      </div>
                                      {project.due_date && (
                                        <div className={`flex items-center gap-1 text-xs ${
                                          new Date(project.due_date) < new Date() 
                                            ? 'text-red-500' 
                                            : new Date(project.due_date) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                                            ? 'text-orange-500'
                                            : 'text-neutral-500 dark:text-neutral-400'
                                        }`}>
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                          </svg>
                                          <span>{new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))
                            ) : null}
                            
                            {/* Create Project Button - always visible */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => {
                                setShowProjectsWindow(true);
                                bringToFront('projects');
                                openCreateProjectDialog(selectedCard.property_name);
                              }}
                            >
                              Create Project
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <SheetFooter>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedCard(null)}
                      className="w-full"
                    >
                      Close
                    </Button>
                  </SheetFooter>
                </>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>}

      {/* Attachment Lightbox Dialog - at root level for proper state reactivity */}
      <Dialog 
        open={viewingAttachmentIndex !== null} 
        onOpenChange={(open) => {
          if (!open) setViewingAttachmentIndex(null);
        }}
      >
        <DialogContent className="max-w-none sm:max-w-none w-screen h-screen p-0 border-0 bg-black/95 [&>button]:hidden rounded-none">
          {/* Hidden title for accessibility */}
          <DialogTitle className="sr-only">Attachment Viewer</DialogTitle>
          
          {viewingAttachmentIndex !== null && projectAttachments[viewingAttachmentIndex] && (
            <div className="relative w-full h-full">
              {/* Fixed Header - always at top */}
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-20">
                <span className="text-white/70 text-sm">
                  {viewingAttachmentIndex + 1} / {projectAttachments.length}
                </span>
                <button
                  onClick={() => setViewingAttachmentIndex(null)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Left Arrow - fixed to left edge, vertically centered */}
              {projectAttachments.length > 1 && (
                <button
                  onClick={() => navigateAttachment('prev')}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 hover:bg-white/10 rounded-full transition-colors"
                >
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              
              {/* Centered content area with padding for controls */}
              <div className="absolute inset-0 flex items-center justify-center px-20 py-20">
                {projectAttachments[viewingAttachmentIndex]?.file_type === 'image' ? (
                  <img 
                    src={projectAttachments[viewingAttachmentIndex].url} 
                    alt="" 
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <video 
                    src={projectAttachments[viewingAttachmentIndex]?.url}
                    controls
                    autoPlay
                    className="max-h-full max-w-full"
                  />
                )}
              </div>
              
              {/* Right Arrow - fixed to right edge, vertically centered */}
              {projectAttachments.length > 1 && (
                <button
                  onClick={() => navigateAttachment('next')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 hover:bg-white/10 rounded-full transition-colors"
                >
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

