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
  });
  const [sortBy, setSortBy] = useState('status-priority');
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);
  const [showProjectsWindow, setShowProjectsWindow] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<1 | 2>(1);
  const [activeWindow, setActiveWindow] = useState<'cards' | 'timeline' | 'projects'>('cards');
  const [windowOrder, setWindowOrder] = useState<Array<'cards' | 'timeline' | 'projects'>>(['cards', 'timeline', 'projects']);
  const [projects, setProjects] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
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
  
  // Combobox open states for staff assignment
  const [turnoverStaffOpen, setTurnoverStaffOpen] = useState(false);
  const [projectStaffOpen, setProjectStaffOpen] = useState(false);

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
  }, [showProjectsWindow]);

  // Also fetch projects when viewing projects in turnover detail
  useEffect(() => {
    if (selectedCard && rightPanelView === 'projects' && projects.length === 0) {
      fetchProjects();
    }
  }, [selectedCard, rightPanelView]);

  // Fetch comments when a project is expanded
  useEffect(() => {
    if (expandedProject?.id) {
      fetchProjectComments(expandedProject.id);
      // Initialize editing fields
      setEditingProjectFields({
        title: expandedProject.title || '',
        description: expandedProject.description || '',
        status: expandedProject.status || 'not_started',
        priority: expandedProject.priority || 'medium',
        assigned_staff: expandedProject.project_assignments?.[0]?.user_id || '',
        due_date: expandedProject.due_date ? expandedProject.due_date.split('T')[0] : ''
      });
    } else {
      setProjectComments([]);
      setNewComment('');
      setEditingProjectFields(null);
    }
  }, [expandedProject?.id]);

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
      due_date: project.due_date ? project.due_date.split('T')[0] : ''
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
          due_date: editingProjectFields.due_date || null
        })
      });
      
      const data = await res.json();
      if (data.data) {
        // Update local projects list
        setProjects(prev => prev.map(p => p.id === expandedProject.id ? data.data : p));
        // Update expanded project
        setExpandedProject(data.data);
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
    return filters.turnoverStatus.length + filters.occupancyStatus.length;
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

  // Memoize window contents to prevent re-renders when only z-index changes
  const cardsWindowContent = useMemo(() => (
    <div className="flex h-full overflow-hidden">
      {/* Left Panel - Cards */}
      <div className={`${selectedCard ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-700' : 'w-full'} transition-all duration-300 overflow-y-auto hide-scrollbar p-6 space-y-4`}>
      {/* Response Display */}
      {response !== null && (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Turnover Status Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2">
                      Turnover Status
                      {filters.turnoverStatus.length > 0 && (
                        <span className="text-muted-foreground">({filters.turnoverStatus.length})</span>
                      )}
                      <ChevronDownIcon className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuCheckboxItemRight
                      checked={filters.turnoverStatus.includes('not_started')}
                      onCheckedChange={() => toggleFilter('turnoverStatus', 'not_started')}
                    >
                      Not Started
                    </DropdownMenuCheckboxItemRight>
                    <DropdownMenuCheckboxItemRight
                      checked={filters.turnoverStatus.includes('in_progress')}
                      onCheckedChange={() => toggleFilter('turnoverStatus', 'in_progress')}
                    >
                      In Progress
                    </DropdownMenuCheckboxItemRight>
                    <DropdownMenuCheckboxItemRight
                      checked={filters.turnoverStatus.includes('complete')}
                      onCheckedChange={() => toggleFilter('turnoverStatus', 'complete')}
                    >
                      Complete
                    </DropdownMenuCheckboxItemRight>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Occupancy Status Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2">
                      Occupancy
                      {filters.occupancyStatus.length > 0 && (
                        <span className="text-muted-foreground">({filters.occupancyStatus.length})</span>
                      )}
                      <ChevronDownIcon className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuCheckboxItemRight
                      checked={filters.occupancyStatus.includes('occupied')}
                      onCheckedChange={() => toggleFilter('occupancyStatus', 'occupied')}
                    >
                      Occupied
                    </DropdownMenuCheckboxItemRight>
                    <DropdownMenuCheckboxItemRight
                      checked={filters.occupancyStatus.includes('vacant')}
                      onCheckedChange={() => toggleFilter('occupancyStatus', 'vacant')}
                    >
                      Vacant
                    </DropdownMenuCheckboxItemRight>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Clear Filters */}
                {getActiveFilterCount() > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-sm text-red-600 dark:text-red-400 hover:underline"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Turnovers: {Array.isArray(response) ? response.length : 1} total
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1 text-xs font-medium rounded ${
                  viewMode === 'cards'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode('json')}
                className={`px-3 py-1 text-xs font-medium rounded ${
                  viewMode === 'json'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                JSON
              </button>
            </div>
          </div>

          <div>
            {viewMode === 'cards' ? (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                <TurnoverCards
                  data={Array.isArray(response) ? response : [response]}
                  filters={filters}
                  sortBy={sortBy}
                  onCardClick={setSelectedCard}
                  compact={!!selectedCard}
                />
              </div>
            ) : (
              <div className="p-4 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                <pre className="text-sm text-neutral-900 dark:text-neutral-100 font-mono whitespace-pre-wrap">
                  {JSON.stringify(response, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Right Panel - Turnover Detail */}
      {selectedCard && (
        <div 
          ref={rightPanelRef}
          className="w-1/2 h-full overflow-y-auto border-l border-neutral-200 dark:border-neutral-700 bg-card"
          onScroll={(e) => {
            scrollPositionRef.current = e.currentTarget.scrollTop;
          }}
        >
          {fullscreenTask ? (
            /* Task Template View */
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="sticky top-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">{fullscreenTask.template_name || 'Task'}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-neutral-500">{selectedCard.property_name}</span>
                      <Badge
                        className={fullscreenTask.type === 'maintenance' 
                          ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                          : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        }
                      >
                        {fullscreenTask.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                      </Badge>
                    </div>
                  </div>
                  <button
                    onClick={() => setFullscreenTask(null)}
                    className="p-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 p-6 space-y-4">
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

              {/* Footer */}
              <div className="border-t border-neutral-200 dark:border-neutral-700 p-4">
                <Button
                  variant="outline"
                  onClick={() => setFullscreenTask(null)}
                  className="w-full"
                >
                  Back to Tasks
                </Button>
              </div>
            </div>
          ) : (
            /* Turnover Card Detail */
            <div className="flex flex-col h-full">
              {/* Sticky Header - Property Info + Toggle */}
              <div className="sticky top-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700">
                {/* Top Row: Property name, Guest, Dates, Occupancy, Close button */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    {/* Property & Guest */}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold truncate">{selectedCard.property_name}</h2>
                      {selectedCard.guest_name && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-neutral-500">
                          <svg className="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span className="truncate">{selectedCard.guest_name}</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Dates & Occupancy - Compact */}
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Out</div>
                        <div className="font-medium text-red-600 dark:text-red-400">
                          {selectedCard.check_out ? new Date(selectedCard.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Next In</div>
                        <div className="font-medium text-green-600 dark:text-green-400">
                          {selectedCard.next_check_in ? new Date(selectedCard.next_check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <Badge 
                        variant="outline"
                        className={`text-xs px-2 py-0.5 ${
                          selectedCard.occupancy_status === 'occupied' 
                            ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300' 
                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300'
                        }`}
                      >
                        {selectedCard.occupancy_status === 'occupied' ? 'Occupied' : 'Vacant'}
                      </Badge>
                    </div>
                    
                    {/* Close Button */}
                    <button
                      onClick={() => {
                        setSelectedCard(null);
                        setShowAddTaskDialog(false);
                        setFullscreenTask(null);
                        setRightPanelView('tasks');
                        setExpandedTurnoverProject(null);
                        setTurnoverProjectFields(null);
                      }}
                      className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {/* Toggle Button Row */}
                <div className="px-4 pb-3">
                  <div className="flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1">
                    <button
                      onClick={() => {
                        setRightPanelView('tasks');
                        setExpandedTurnoverProject(null);
                        setTurnoverProjectFields(null);
                      }}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        rightPanelView === 'tasks'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      Turnover Tasks ({selectedCard.completed_tasks || 0}/{selectedCard.total_tasks || 0})
                    </button>
                    <button
                      onClick={() => setRightPanelView('projects')}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        rightPanelView === 'projects'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      Property Projects ({projects.filter(p => p.property_name === selectedCard.property_name).length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto hide-scrollbar p-4 space-y-3">
                {rightPanelView === 'tasks' ? (
                  /* Tasks View */
                  <>
                {selectedCard.tasks && selectedCard.tasks.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">
                        Click a task to open
                      </div>
                    </div>

                    <div className="space-y-3">
                      {selectedCard.tasks.map((task: any) => {
                        const assignedUserIds = (task.assigned_users || []).map((u: any) => u.user_id);
                        const taskStatus = task.status || 'not_started';
                        
                        const getStatusStyles = (status: string) => {
                          switch (status) {
                            case 'complete':
                              return { border: 'border', badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
                            case 'in_progress':
                              return { border: 'border', badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800' };
                            case 'paused':
                              return { border: 'border', badge: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
                            default:
                              return { border: 'border', badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' };
                          }
                        };
                        
                        const statusStyles = getStatusStyles(taskStatus);
                        
                        return (
                          <Card 
                            key={task.task_id}
                            className={`cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 ${statusStyles.border}`}
                            onClick={async () => {
                              if (task.template_id && !taskTemplates[task.template_id]) {
                                await fetchTaskTemplate(task.template_id);
                              }
                              setFullscreenTask(task);
                            }}
                          >
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-base">{task.template_name || 'Unnamed Task'}</CardTitle>
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
                              
                              <div className="flex items-center gap-2 mt-2">
                                <Badge className={`px-2 py-0.5 text-xs border ${statusStyles.badge}`}>
                                  {taskStatus === 'complete' ? 'Complete' :
                                   taskStatus === 'in_progress' ? 'In Progress' :
                                   taskStatus === 'paused' ? 'Paused' :
                                   taskStatus === 'reopened' ? 'Reopened' :
                                   'Not Started'}
                                </Badge>
                                <Badge className={`px-2 py-0.5 text-xs border ${task.type === 'maintenance' 
                                  ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                  : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                                }`}>
                                  {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                </Badge>
                              </div>
                              
                              <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-700">
                                <div className="flex items-center gap-2">
                                  <Popover>
                                    <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                                        {task.scheduled_start ? new Date(task.scheduled_start).toLocaleDateString() : 'Date'}
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
                                    value={task.scheduled_start ? new Date(task.scheduled_start).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : ''}
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
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddTaskDialog(false)}>✕</Button>
                        </div>
                        
                        {availableTemplates.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {availableTemplates
                              .filter(template => !selectedCard.tasks?.some((t: any) => t.template_id === template.id))
                              .map((template) => (
                                <button
                                  key={template.id}
                                  className="w-full p-3 text-left border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                                  onClick={() => addTaskToCard(template.id)}
                                >
                                  <div className="font-medium text-sm">{template.name}</div>
                                  <div className="text-xs text-neutral-500 capitalize">{template.type}</div>
                                </button>
                              ))}
                          </div>
                        ) : (
                          <p className="text-sm text-neutral-500">Loading templates...</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-neutral-500">
                    <p>No tasks assigned yet</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        fetchAvailableTemplates();
                        setShowAddTaskDialog(true);
                      }}
                    >
                      Add Task
                    </Button>
                    
                    {showAddTaskDialog && (
                      <div className="mt-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-left">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-medium text-neutral-900 dark:text-white">Select a Template</h4>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddTaskDialog(false)}>✕</Button>
                        </div>
                        
                        {availableTemplates.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {availableTemplates.map((template) => (
                              <button
                                key={template.id}
                                className="w-full p-3 text-left border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                                onClick={() => addTaskToCard(template.id)}
                              >
                                <div className="font-medium text-sm">{template.name}</div>
                                <div className="text-xs text-neutral-500 capitalize">{template.type}</div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-neutral-500">Loading templates...</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                  </>
                ) : (
                  /* Projects View */
                  <div className="space-y-3">
                    {expandedTurnoverProject && turnoverProjectFields ? (
                      /* Expanded Project Detail View */
                      <div className="space-y-4">
                        {/* Back button */}
                        <button
                          onClick={() => {
                            setExpandedTurnoverProject(null);
                            setTurnoverProjectFields(null);
                          }}
                          className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                          Back to Projects
                        </button>

                        {/* Project Header with pop-out */}
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-neutral-900 dark:text-white">{expandedTurnoverProject.title}</h4>
                          <button
                            onClick={() => {
                              setExpandedProject(expandedTurnoverProject);
                              setEditingProjectFields({
                                title: expandedTurnoverProject.title,
                                description: expandedTurnoverProject.description || '',
                                status: expandedTurnoverProject.status,
                                priority: expandedTurnoverProject.priority,
                                assigned_staff: expandedTurnoverProject.project_assignments?.[0]?.user_id || '',
                                due_date: expandedTurnoverProject.due_date || ''
                              });
                              setShowProjectsWindow(true);
                              bringToFront('projects');
                            }}
                            className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded transition-colors"
                            title="Open in Projects window"
                          >
                            <svg className="w-4 h-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </button>
                        </div>

                        {/* Editable Form */}
                        <div className="space-y-4">
                          {/* Title */}
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-neutral-900 dark:text-white">Title</label>
                            <Input
                              value={turnoverProjectFields.title}
                              onChange={(e) => setTurnoverProjectFields(prev => prev ? {...prev, title: e.target.value} : null)}
                              placeholder="Project title"
                            />
                          </div>

                          {/* Description */}
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-neutral-900 dark:text-white">Description</label>
                            <Textarea
                              value={turnoverProjectFields.description}
                              onChange={(e) => setTurnoverProjectFields(prev => prev ? {...prev, description: e.target.value} : null)}
                              placeholder="Project description (optional)"
                              rows={3}
                            />
                          </div>

                          {/* Status & Priority */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-neutral-900 dark:text-white">Status</label>
                              <Select
                                value={turnoverProjectFields.status}
                                onValueChange={(value) => setTurnoverProjectFields(prev => prev ? {...prev, status: value} : null)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="not_started">Not Started</SelectItem>
                                  <SelectItem value="in_progress">In Progress</SelectItem>
                                  <SelectItem value="on_hold">On Hold</SelectItem>
                                  <SelectItem value="complete">Complete</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-neutral-900 dark:text-white">Priority</label>
                              <Select
                                value={turnoverProjectFields.priority}
                                onValueChange={(value) => setTurnoverProjectFields(prev => prev ? {...prev, priority: value} : null)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">Low</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                  <SelectItem value="high">High</SelectItem>
                                  <SelectItem value="urgent">Urgent</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {/* Assigned Staff & Due Date */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-neutral-900 dark:text-white">Assigned To</label>
                              <Popover open={turnoverStaffOpen} onOpenChange={setTurnoverStaffOpen}>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={turnoverStaffOpen}
                                    className="w-full justify-between font-normal"
                                    onPointerDown={(e) => {
                                      e.preventDefault();
                                      setTurnoverStaffOpen(!turnoverStaffOpen);
                                    }}
                                  >
                                    {turnoverProjectFields.assigned_staff
                                      ? users.find((user) => user.id === turnoverProjectFields.assigned_staff)?.name || "Unknown"
                                      : "Select staff..."}
                                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0">
                                  <Command>
                                    <CommandInput placeholder="Search staff..." />
                                    <CommandList>
                                      <CommandEmpty>No staff found.</CommandEmpty>
                                      <CommandGroup>
                                        <CommandItem
                                          value="unassigned"
                                          onSelect={() => {
                                            setTurnoverProjectFields(prev => prev ? {...prev, assigned_staff: ''} : null);
                                            setTurnoverStaffOpen(false);
                                          }}
                                        >
                                          <CheckIcon className={cn("mr-2 h-4 w-4", !turnoverProjectFields.assigned_staff ? "opacity-100" : "opacity-0")} />
                                          Unassigned
                                        </CommandItem>
                                        {users.map((user) => (
                                          <CommandItem
                                            key={user.id}
                                            value={user.name}
                                            onSelect={() => {
                                              setTurnoverProjectFields(prev => prev ? {...prev, assigned_staff: user.id} : null);
                                              setTurnoverStaffOpen(false);
                                            }}
                                          >
                                            <CheckIcon className={cn("mr-2 h-4 w-4", turnoverProjectFields.assigned_staff === user.id ? "opacity-100" : "opacity-0")} />
                                            {user.name}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-neutral-900 dark:text-white">Due Date</label>
                              <Input
                                type="date"
                                value={turnoverProjectFields.due_date}
                                onChange={(e) => setTurnoverProjectFields(prev => prev ? {...prev, due_date: e.target.value} : null)}
                              />
                            </div>
                          </div>

                          {/* Discussion Section - Collapsible */}
                          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                            <button
                              onClick={() => setTurnoverDiscussionExpanded(!turnoverDiscussionExpanded)}
                              className="w-full px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800/50 flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                            >
                              <span className="font-medium text-sm text-neutral-900 dark:text-white flex items-center gap-2">
                                <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                Discussion
                                {projectComments.filter((c: any) => c.project_id === expandedTurnoverProject.id).length > 0 && (
                                  <Badge variant="secondary" className="text-xs ml-1">
                                    {projectComments.filter((c: any) => c.project_id === expandedTurnoverProject.id).length}
                                  </Badge>
                                )}
                              </span>
                              <svg 
                                className={`w-4 h-4 text-neutral-500 transition-transform ${turnoverDiscussionExpanded ? 'rotate-180' : ''}`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            
                            {turnoverDiscussionExpanded && (
                              <div className="p-4 border-t border-neutral-200 dark:border-neutral-700">
                                {/* Comment Input */}
                                <div className="flex gap-2 mb-3">
                                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                    {currentUser.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1">
                                    <Textarea
                                      placeholder="Add a comment..."
                                      rows={2}
                                      className="resize-none text-sm"
                                      value={newComment}
                                      onChange={(e) => setNewComment(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) {
                                          e.preventDefault();
                                          // Post comment for turnover project
                                          if (expandedTurnoverProject) {
                                            setPostingComment(true);
                                            fetch('/api/project-comments', {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({
                                                project_id: expandedTurnoverProject.id,
                                                user_id: currentUser.id,
                                                comment_content: newComment.trim()
                                              })
                                            })
                                            .then(res => res.json())
                                            .then(data => {
                                              if (data.success && data.data) {
                                                setProjectComments((prev: any) => [...prev, data.data]);
                                                setNewComment('');
                                              }
                                            })
                                            .finally(() => setPostingComment(false));
                                          }
                                        }
                                      }}
                                      disabled={postingComment}
                                    />
                                    <p className="text-xs text-neutral-400 mt-1">Press Enter to post</p>
                                  </div>
                                </div>

                                {/* Comments List */}
                                <div className="space-y-3 pt-3 border-t border-neutral-200 dark:border-neutral-700 max-h-48 overflow-y-auto">
                                  {projectComments.filter((c: any) => c.project_id === expandedTurnoverProject.id).length === 0 ? (
                                    <p className="text-center text-sm text-neutral-400 py-2">No comments yet</p>
                                  ) : (
                                    projectComments
                                      .filter((c: any) => c.project_id === expandedTurnoverProject.id)
                                      .map((comment: any) => (
                                        <div key={comment.id} className="flex gap-2">
                                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                                            {comment.users?.avatar || (comment.users?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                              <span className="font-medium text-xs text-neutral-900 dark:text-white">
                                                {comment.users?.name || 'Unknown'}
                                              </span>
                                              <span className="text-xs text-neutral-400">
                                                {new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                              </span>
                                            </div>
                                            <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                              {comment.comment_content}
                                            </p>
                                          </div>
                                        </div>
                                      ))
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Save Button */}
                          <Button
                            onClick={saveTurnoverProjectChanges}
                            disabled={savingTurnoverProject}
                            className="w-full"
                          >
                            {savingTurnoverProject ? 'Saving...' : 'Save Changes'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Projects List */
                      <>
                        {projects.filter(p => p.property_name === selectedCard.property_name).length > 0 ? (
                          <>
                            {projects
                              .filter(p => p.property_name === selectedCard.property_name)
                              .map((project: any) => (
                                <Card 
                                  key={project.id}
                                  className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 border"
                                  onClick={() => {
                                    setExpandedTurnoverProject(project);
                                    setTurnoverProjectFields({
                                      title: project.title,
                                      description: project.description || '',
                                      status: project.status,
                                      priority: project.priority,
                                      assigned_staff: project.project_assignments?.[0]?.user_id || '',
                                      due_date: project.due_date || ''
                                    });
                                    // Fetch comments for this project
                                    fetchProjectComments(project.id);
                                  }}
                                >
                                  <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <CardTitle className="text-base">{project.title}</CardTitle>
                                        {/* Pop-out icon to open in Projects window */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
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
                                          className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded transition-colors"
                                          title="Open in Projects window"
                                        >
                                          <svg className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                        </button>
                                      </div>
                                      <Badge 
                                        variant="outline"
                                        className={`text-xs ${
                                          project.priority === 'urgent' ? 'bg-red-100 text-red-700 border-red-300' :
                                          project.priority === 'high' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                                          project.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                                          'bg-neutral-100 text-neutral-600 border-neutral-300'
                                        }`}
                                      >
                                        {project.priority}
                                      </Badge>
                                    </div>
                                    {project.description && (
                                      <CardDescription className="text-sm line-clamp-2 mt-1">
                                        {project.description}
                                      </CardDescription>
                                    )}
                                  </CardHeader>
                                  <CardContent className="pt-0 pb-3">
                                    <div className="flex items-center justify-between text-xs">
                                      <Badge 
                                        variant="outline"
                                        className={`${
                                          project.status === 'complete' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                                          project.status === 'in_progress' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                                          project.status === 'blocked' ? 'bg-red-100 text-red-700 border-red-300' :
                                          'bg-neutral-100 text-neutral-600 border-neutral-300'
                                        }`}
                                      >
                                        {project.status === 'not_started' ? 'Not Started' :
                                         project.status === 'in_progress' ? 'In Progress' :
                                         project.status === 'complete' ? 'Complete' :
                                         project.status === 'blocked' ? 'Blocked' : project.status}
                                      </Badge>
                                      {project.due_date && (
                                        <span className="text-neutral-500">
                                          Due: {new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                      )}
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            <Button
                              variant="outline"
                              className="w-full mt-2"
                              onClick={() => openCreateProjectDialog(selectedCard.property_name)}
                            >
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                              Add Project
                            </Button>
                          </>
                        ) : (
                          <div className="text-center py-8 text-neutral-500">
                            <p>No projects for this property yet</p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => openCreateProjectDialog(selectedCard.property_name)}
                            >
                              Create Project
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  ), [response, viewMode, filters, sortBy, selectedCard, fullscreenTask, showAddTaskDialog, availableTemplates, taskTemplates, loadingTaskTemplate, users, rightPanelView, projects, expandedTurnoverProject, turnoverProjectFields, turnoverDiscussionExpanded, savingTurnoverProject, projectComments, newComment, postingComment]);

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

  const projectsWindowContent = useMemo(() => (
    <div className="flex h-full">
      {/* Left Panel - Project List */}
      <div className={`${expandedProject ? 'w-1/2' : 'w-full'} h-full overflow-auto transition-all duration-300 hide-scrollbar`}>
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between sticky top-0 bg-white dark:bg-neutral-900 z-10 pb-2">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
              Property Projects
            </h3>
            <Button size="sm" onClick={() => openCreateProjectDialog()}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New Project
            </Button>
          </div>

          {/* Projects List */}
          {loadingProjects ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-neutral-500">Loading projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                No projects yet. Create your first property project!
              </p>
              <Button onClick={() => openCreateProjectDialog()}>
                Create First Project
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedProjects).sort().map(([propertyName, propertyProjects]) => (
                <div key={propertyName} className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm">
                  {/* Property Header */}
                  <div className="px-4 py-3 bg-gradient-to-r from-neutral-50 to-neutral-100 dark:from-neutral-800 dark:to-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-neutral-900 dark:text-white">
                        {propertyName}
                      </h4>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {propertyProjects.length} project{propertyProjects.length !== 1 ? 's' : ''}
                        </Badge>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0"
                          onClick={() => openCreateProjectDialog(propertyName)}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Projects Grid */}
                  <div className={`p-4 grid gap-4 auto-rows-fr ${expandedProject ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                    {propertyProjects.map((project: any) => (
                      <Card 
                        key={project.id} 
                        className={`group w-full gap-4 !p-4 hover:shadow-lg transition-all duration-200 !flex !flex-col cursor-pointer ${
                          expandedProject?.id === project.id 
                            ? 'ring-1 ring-amber-400/70 shadow-md' 
                            : ''
                        }`}
                        onClick={() => setExpandedProject(expandedProject?.id === project.id ? null : project)}
                      >
                        <CardHeader className="min-h-[4.5rem]">
                          <CardTitle className="text-base leading-tight line-clamp-2">{project.title}</CardTitle>
                          <CardDescription className="line-clamp-2 text-muted-foreground">
                            {project.description || '\u00A0'}
                          </CardDescription>
                        </CardHeader>

                        <CardContent className="flex-grow">
                          <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge 
                                className={`px-2.5 py-1 ${
                                  project.priority === 'urgent' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' :
                                  project.priority === 'high' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800' :
                                  project.priority === 'medium' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                                  'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                                }`}
                              >
                                {project.priority}
                              </Badge>
                              <Badge 
                                className={`px-2.5 py-1 ${
                                  project.status === 'complete' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800' :
                                  project.status === 'in_progress' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                                  project.status === 'on_hold' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800' :
                                  'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                                }`}
                              >
                                {project.status?.replace('_', ' ') || 'not started'}
                              </Badge>
                            </div>
                            {project.assigned_staff && (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                                {project.assigned_staff.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                        </CardContent>

                        <CardFooter className="mt-auto flex flex-col gap-2">
                          <div className="w-full py-1">
                            <div className="h-px w-full bg-border/60" />
                          </div>
                          <div className="flex w-full justify-between text-xs text-muted-foreground/60">
                            <div className="flex items-center gap-2">
                              {project.assigned_staff && (
                                <div className="flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 transition-all duration-150 hover:border-border hover:bg-[var(--mix-card-50-bg)]">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                  <span className="max-w-[80px] truncate">{project.assigned_staff}</span>
                                </div>
                              )}
                            </div>
                            {project.due_date && (
                              <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 transition-all duration-150 hover:border-border hover:bg-[var(--mix-card-50-bg)] ${
                                new Date(project.due_date) < new Date() ? 'text-red-500' :
                                new Date(project.due_date) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) ? 'text-[var(--warning-foreground)]' :
                                ''
                              }`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span>{new Date(project.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </div>
                            )}
                          </div>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Project Detail */}
      {expandedProject && editingProjectFields && (
        <div className="w-1/2 h-full overflow-y-auto hide-scrollbar border-l border-neutral-200 dark:border-neutral-700 bg-card">
          {/* Header */}
          <div className="sticky top-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{expandedProject.property_name}</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this project?')) {
                      deleteProject(expandedProject);
                      setExpandedProject(null);
                    }
                  }}
                  className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Delete project"
                >
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setExpandedProject(null)}
                  className="p-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                  title="Close"
                >
                  <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Edit project details and manage discussion</p>
          </div>

          {/* Form Content - Padded Container */}
          <div className="p-6 space-y-6">
              {/* Title Field */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900 dark:text-white">Title</label>
                <Input
                  value={editingProjectFields.title}
                  onChange={(e) => setEditingProjectFields(prev => prev ? {...prev, title: e.target.value} : null)}
                  placeholder="Project title"
                />
              </div>

              {/* Description Field */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900 dark:text-white">Description</label>
                <Textarea
                  value={editingProjectFields.description}
                  onChange={(e) => setEditingProjectFields(prev => prev ? {...prev, description: e.target.value} : null)}
                  placeholder="Project description (optional)"
                  rows={3}
                />
              </div>

              {/* Status & Priority */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-900 dark:text-white">Status</label>
                  <Select
                    value={editingProjectFields.status}
                    onValueChange={(value) => setEditingProjectFields(prev => prev ? {...prev, status: value} : null)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Not Started</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-900 dark:text-white">Priority</label>
                  <Select
                    value={editingProjectFields.priority}
                    onValueChange={(value) => setEditingProjectFields(prev => prev ? {...prev, priority: value} : null)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Assigned Staff & Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-900 dark:text-white">Assigned To</label>
                  <Popover open={projectStaffOpen} onOpenChange={setProjectStaffOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={projectStaffOpen}
                        className="w-full justify-between font-normal"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          setProjectStaffOpen(!projectStaffOpen);
                        }}
                      >
                        {editingProjectFields.assigned_staff
                          ? users.find((user) => user.id === editingProjectFields.assigned_staff)?.name || "Unknown"
                          : "Select staff..."}
                        <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0">
                      <Command>
                        <CommandInput placeholder="Search staff..." />
                        <CommandList>
                          <CommandEmpty>No staff found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="unassigned"
                              onSelect={() => {
                                setEditingProjectFields(prev => prev ? {...prev, assigned_staff: ''} : null);
                                setProjectStaffOpen(false);
                              }}
                            >
                              <CheckIcon className={cn("mr-2 h-4 w-4", !editingProjectFields.assigned_staff ? "opacity-100" : "opacity-0")} />
                              Unassigned
                            </CommandItem>
                            {users.map((user) => (
                              <CommandItem
                                key={user.id}
                                value={user.name}
                                onSelect={() => {
                                  setEditingProjectFields(prev => prev ? {...prev, assigned_staff: user.id} : null);
                                  setProjectStaffOpen(false);
                                }}
                              >
                                <CheckIcon className={cn("mr-2 h-4 w-4", editingProjectFields.assigned_staff === user.id ? "opacity-100" : "opacity-0")} />
                                {user.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-900 dark:text-white">Due Date</label>
                  <Input
                    type="date"
                    value={editingProjectFields.due_date}
                    onChange={(e) => setEditingProjectFields(prev => prev ? {...prev, due_date: e.target.value} : null)}
                  />
                </div>
              </div>

              {/* Discussion Section - Collapsible */}
              <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <button
                  onClick={() => setDiscussionExpanded(!discussionExpanded)}
                  className="w-full px-6 py-3 bg-neutral-50 dark:bg-neutral-800/50 flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <h3 className="font-medium text-neutral-900 dark:text-white flex items-center gap-2">
                    <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Discussion
                    {projectComments.length > 0 && (
                      <Badge variant="secondary" className="text-xs ml-1">
                        {projectComments.length}
                      </Badge>
                    )}
                  </h3>
                  <svg 
                    className={`w-4 h-4 text-neutral-500 transition-transform ${discussionExpanded ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {discussionExpanded && (
                  <div className="p-6 border-t border-neutral-200 dark:border-neutral-700">
                    {/* Comment Input */}
                    <div className="flex gap-3 mb-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        {currentUser.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <Textarea
                          placeholder="Add a comment... (Press Enter to post)"
                          rows={2}
                          className="resize-none"
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) {
                              e.preventDefault();
                              postProjectComment();
                            }
                          }}
                          disabled={postingComment}
                        />
                        <p className="text-xs text-neutral-400 mt-1">Press Enter to post, Shift+Enter for new line</p>
                      </div>
                    </div>

                    {/* Comments List */}
                    <div className="space-y-4 pt-4 border-t border-neutral-200 dark:border-neutral-700">
                      {loadingComments ? (
                        <div className="text-center py-4 text-neutral-400 dark:text-neutral-500">
                          <p className="text-sm">Loading comments...</p>
                        </div>
                      ) : projectComments.length === 0 ? (
                        <div className="text-center py-4 text-neutral-400 dark:text-neutral-500">
                          <p className="text-sm">No comments yet</p>
                          <p className="text-xs mt-1">Start the discussion above</p>
                        </div>
                      ) : (
                        projectComments.map((comment: any) => (
                          <div key={comment.id} className="flex gap-3">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                              {comment.users?.avatar || (comment.users?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm text-neutral-900 dark:text-white">
                                  {comment.users?.name || 'Unknown User'}
                                </span>
                                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                                  {new Date(comment.created_at).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </div>
                              <p className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                                {comment.comment_content}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            {/* Save Button */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <Button
                onClick={saveProjectChanges}
                disabled={savingProjectEdit}
                className="w-full"
              >
                {savingProjectEdit ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Project Dialog */}
      <Dialog open={showProjectDialog} onOpenChange={(open) => {
        if (!open) {
          setShowProjectDialog(false);
          resetProjectForm();
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? 'Edit Project' : 'New Project'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Property */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Property *
              </label>
              <select
                className="w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
                value={projectForm.property_name}
                onChange={(e) => setProjectForm(prev => ({ ...prev, property_name: e.target.value }))}
                disabled={!!editingProject}
              >
                <option value="">Select a property</option>
                {allProperties.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Title *
              </label>
              <Input
                value={projectForm.title}
                onChange={(e) => setProjectForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Project title"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Description
              </label>
              <Textarea
                value={projectForm.description}
                onChange={(e) => setProjectForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Project description (optional)"
                rows={2}
              />
            </div>

            {/* Status & Priority */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Status
                </label>
                <select
                  className="w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
                  value={projectForm.status}
                  onChange={(e) => setProjectForm(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="on_hold">On Hold</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Priority
                </label>
                <select
                  className="w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
                  value={projectForm.priority}
                  onChange={(e) => setProjectForm(prev => ({ ...prev, priority: e.target.value }))}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            {/* Assigned Staff */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Assigned Staff
              </label>
              <Input
                value={projectForm.assigned_staff}
                onChange={(e) => setProjectForm(prev => ({ ...prev, assigned_staff: e.target.value }))}
                placeholder="Staff name (optional)"
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Due Date
              </label>
              <Input
                type="date"
                value={projectForm.due_date}
                onChange={(e) => setProjectForm(prev => ({ ...prev, due_date: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProjectDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveProject} 
              disabled={savingProject || !projectForm.property_name || !projectForm.title}
            >
              {savingProject ? 'Saving...' : editingProject ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  ), [projects, loadingProjects, groupedProjects, showProjectDialog, editingProject, projectForm, savingProject, allProperties, expandedProject, projectComments, loadingComments, newComment, postingComment, currentUser, editingProjectFields, savingProjectEdit, discussionExpanded]);

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
          className="flex-1 relative overflow-hidden"
          style={{
            backgroundImage: `url("/ambientbackground${backgroundImage === 1 ? '' : '2'}.png")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
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
              {cardsWindowContent}
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
              {projectsWindowContent}
            </FloatingWindow>
          )}

          {/* Background Toggle Button */}
          <button
            onClick={() => setBackgroundImage(prev => prev === 1 ? 2 : 1)}
            className="absolute bottom-4 left-4 p-2 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-sm border border-white/10 transition-all duration-200 opacity-40 hover:opacity-100 z-50"
            title={`Switch to background ${backgroundImage === 1 ? '2' : '1'}`}
          >
            <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>

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

    </div>
  );
}

