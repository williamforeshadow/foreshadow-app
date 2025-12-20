'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OpenAI from 'openai';
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
import { ChevronDownIcon } from 'lucide-react';
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
  MobileCardsView, 
  MobileTimelineView, 
  MobileQueryView, 
  MobileProjectsView,
  type MobileTab 
} from '@/components/mobile';

export default function Home() {
  // Mobile detection
  const isMobile = useIsMobile();
  const { user: currentUser } = useAuth();
  const [mobileTab, setMobileTab] = useState<MobileTab>('cards');
  
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
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    cleanStatus: [] as string[],
    cardActions: [] as string[],
    staff: [] as string[]
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
  const [showPropertyProjects, setShowPropertyProjects] = useState(false);
  const [fullscreenTask, setFullscreenTask] = useState<any>(null);
  const [expandedProject, setExpandedProject] = useState<any>(null);
  
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
        assigned_staff: expandedProject.assigned_staff || '',
        due_date: expandedProject.due_date ? expandedProject.due_date.split('T')[0] : ''
      });
    } else {
      setProjectComments([]);
      setNewComment('');
      setEditingProjectFields(null);
    }
  }, [expandedProject?.id]);

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
          assigned_staff: editingProjectFields.assigned_staff || null,
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
            ? { ...task, card_actions: action, status: result.data.status }
            : task
        );
        
        // Recalculate task counts and turnover_status
        const completedCount = updatedTasks.filter((t: any) => t.status === 'complete').length;
        const inProgressCount = updatedTasks.filter((t: any) => t.status === 'in_progress').length;
        const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
        
        // If this was the first cleaning task, update top-level fields for backward compatibility
        const firstCleaningTask = updatedTasks.find((t: any) => t.type === 'cleaning');
        const updatedTask = updatedTasks.find((t: any) => t.task_id === taskId);
        const shouldUpdateTopLevel = firstCleaningTask && updatedTask && firstCleaningTask.task_id === taskId;
        
        return { 
          ...prev, 
          tasks: updatedTasks,
          completed_tasks: completedCount,
          tasks_in_progress: inProgressCount,
          turnover_status: newTurnoverStatus,
          ...(shouldUpdateTopLevel ? {
            card_actions: action,
            status: result.data.status
          } : {})
        };
      });

      // Also update the response array (grid view)
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard.id && item.tasks) {
            const updatedTasks = item.tasks.map((task: any) => 
              task.task_id === taskId 
                ? { ...task, card_actions: action, status: result.data.status }
                : task
            );
            const completedCount = updatedTasks.filter((t: any) => t.status === 'complete').length;
            const inProgressCount = updatedTasks.filter((t: any) => t.status === 'in_progress').length;
            const newTurnoverStatus = calculateTurnoverStatus(updatedTasks);
            
            // If this was the first cleaning task, update top-level fields for backward compatibility
            const firstCleaningTask = updatedTasks.find((t: any) => t.type === 'cleaning');
            const updatedTask = updatedTasks.find((t: any) => t.task_id === taskId);
            const shouldUpdateTopLevel = firstCleaningTask && updatedTask && firstCleaningTask.task_id === taskId;
            
            return { 
              ...item, 
              tasks: updatedTasks,
              completed_tasks: completedCount,
              tasks_in_progress: inProgressCount,
              turnover_status: newTurnoverStatus,
              ...(shouldUpdateTopLevel ? {
                card_actions: action,
                status: result.data.status
              } : {})
            };
          }
          return item;
        });
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update task action');
    }
  };

  const updateTaskAssignment = async (taskId: string, staffName: string | null) => {
    try {
      const response = await fetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, staffName })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update task assignment');
      }

      // Update the task in selectedCard.tasks array
      setSelectedCard((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        
        const updatedTasks = prev.tasks.map((task: any) => 
          task.task_id === taskId 
            ? { ...task, assigned_staff: staffName }
            : task
        );
        
        // If this was the first cleaning task, update top-level field for backward compatibility
        const firstCleaningTask = updatedTasks.find((t: any) => t.type === 'cleaning');
        const updatedTask = updatedTasks.find((t: any) => t.task_id === taskId);
        const shouldUpdateTopLevel = firstCleaningTask && updatedTask && firstCleaningTask.task_id === taskId;
        
        return { 
          ...prev, 
          tasks: updatedTasks,
          ...(shouldUpdateTopLevel ? { assigned_staff: staffName } : {})
        };
      });

      // Also update the response array
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard.id && item.tasks) {
            const updatedTasks = item.tasks.map((task: any) => 
              task.task_id === taskId 
                ? { ...task, assigned_staff: staffName }
                : task
            );
            
            // If this was the first cleaning task, update top-level field for backward compatibility
            const firstCleaningTask = updatedTasks.find((t: any) => t.type === 'cleaning');
            const updatedTask = updatedTasks.find((t: any) => t.task_id === taskId);
            const shouldUpdateTopLevel = firstCleaningTask && updatedTask && firstCleaningTask.task_id === taskId;
            
            return { 
              ...item, 
              tasks: updatedTasks,
              ...(shouldUpdateTopLevel ? { assigned_staff: staffName } : {})
            };
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

  const saveTaskForm = async (taskId: string, formData: any) => {
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

      // Also update in response array
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => {
          if (item.id === selectedCard.id && item.tasks) {
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

      return result;
    } catch (err: any) {
      console.error('Error saving task form:', err);
      setError(err.message || 'Failed to save task form');
      throw err;
    }
  };

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
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'in_progress':
        return [
          { value: 'paused', label: '⏸️ Pause', icon: '⏸️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'paused':
        return [
          { value: 'in_progress', label: '▶️ Resume', icon: '▶️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'completed':
        return [
          { value: 'not_started', label: '↺ Reopen', icon: '↺' }
        ];
      default:
        return [
          { value: 'in_progress', label: '▶️ Start', icon: '▶️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
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
      cleanStatus: [],
      cardActions: [],
      staff: []
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
    return filters.cleanStatus.length + filters.cardActions.length + filters.staff.length;
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
    <div className="p-6 space-y-4">
      {/* Response Display */}
      {response !== null && (
        <div className="space-y-3">
          {/* Filter and Sort Bar */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span className="font-medium">Filters</span>
                {getActiveFilterCount() > 0 && (
                  <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full">
                    {getActiveFilterCount()}
                  </span>
                )}
                <svg className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div className="flex items-center gap-3">
                {getActiveFilterCount() > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-sm text-red-600 dark:text-red-400 hover:underline"
                  >
                    Clear All
                  </button>
                )}
                
                {/* Sort Dropdown */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">Sort by:</span>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status-priority">Status Priority</SelectItem>
                      <SelectItem value="checkin-soonest">Next Check-in: Soonest</SelectItem>
                      <SelectItem value="checkout-recent">Checkout: Most Recent</SelectItem>
                      <SelectItem value="checkout-oldest">Checkout: Oldest</SelectItem>
                      <SelectItem value="property-az">Property Name: A-Z</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-3 border-t border-neutral-200 dark:border-neutral-800">
                {/* Turnover Status */}
                <div>
                  <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">Turnover Status</h4>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cleanStatus.includes('not_started')}
                        onChange={() => toggleFilter('cleanStatus', 'not_started')}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-red-600">Not Started</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cleanStatus.includes('in_progress')}
                        onChange={() => toggleFilter('cleanStatus', 'in_progress')}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-yellow-600">In Progress</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cleanStatus.includes('complete')}
                        onChange={() => toggleFilter('cleanStatus', 'complete')}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-green-600">Complete</span>
                    </label>
                  </div>
                </div>

                {/* Card Actions */}
                <div>
                  <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">Card Actions</h4>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cardActions.includes('not_started')}
                        onChange={() => toggleFilter('cardActions', 'not_started')}
                        className="rounded border-neutral-300"
                      />
                      <span>Not Started</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cardActions.includes('in_progress')}
                        onChange={() => toggleFilter('cardActions', 'in_progress')}
                        className="rounded border-neutral-300"
                      />
                      <span>In Progress</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cardActions.includes('paused')}
                        onChange={() => toggleFilter('cardActions', 'paused')}
                        className="rounded border-neutral-300"
                      />
                      <span>Paused</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.cardActions.includes('completed')}
                        onChange={() => toggleFilter('cardActions', 'completed')}
                        className="rounded border-neutral-300"
                      />
                      <span>Completed</span>
                    </label>
                  </div>
                </div>

                {/* Staff */}
                <div>
                  <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">Staff</h4>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.staff.includes('unassigned')}
                        onChange={() => toggleFilter('staff', 'unassigned')}
                        className="rounded border-neutral-300"
                      />
                      <span>Unassigned</span>
                    </label>
                    {response && getUniqueStaff(Array.isArray(response) ? response : [response]).map(staff => (
                      <label key={staff} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.staff.includes(staff)}
                          onChange={() => toggleFilter('staff', staff)}
                          className="rounded border-neutral-300"
                        />
                        <span>{staff}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
  ), [response, viewMode, showFilters, filters, sortBy]);

  const timelineWindowContent = useMemo(() => (
    <Timeline onCardClick={setSelectedCard} />
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
                  <Input
                    value={editingProjectFields.assigned_staff}
                    onChange={(e) => setEditingProjectFields(prev => prev ? {...prev, assigned_staff: e.target.value} : null)}
                    placeholder="Staff name (optional)"
                  />
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

  // Mobile query handlers for MobileQueryView
  const handleMobileGenerateSQL = async (naturalQuery: string): Promise<string> => {
    const openai = new OpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY, dangerouslyAllowBrowser: true });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a SQL expert. Convert natural language to PostgreSQL queries for a property management database. Tables: property_turnovers, cleanings, maintenance_cards, projects, templates. Return ONLY the SQL query, no explanation.`
        },
        { role: 'user', content: naturalQuery }
      ]
    });
    return completion.choices[0]?.message?.content || '';
  };

  const handleMobileExecuteQuery = async (sql: string): Promise<any> => {
    const res = await fetch('/api/sql-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Query failed');
    return data.data;
  };

  // Mobile UI
  if (isMobile) {
    return (
      <>
        <MobileLayout
          activeTab={mobileTab}
          onTabChange={setMobileTab}
        >
          {mobileTab === 'cards' && (
            <MobileCardsView
              data={response}
              filters={filters}
              sortBy={sortBy}
              onFiltersChange={setFilters}
              onSortChange={setSortBy}
              onCardClick={setSelectedCard}
              onRefresh={() => quickCall('get_property_turnovers')}
              isLoading={loading}
            />
          )}
          
          {mobileTab === 'timeline' && (
            <MobileTimelineView onCardClick={setSelectedCard} />
          )}
          
          {mobileTab === 'query' && (
            <MobileQueryView
              onGenerateSQL={handleMobileGenerateSQL}
              onExecuteQuery={handleMobileExecuteQuery}
            />
          )}
          
          {mobileTab === 'projects' && (
            <MobileProjectsView
              projects={projects}
              isLoading={loadingProjects}
              onRefresh={fetchProjects}
              onCreateProject={() => openCreateProjectDialog()}
              onEditProject={openEditProjectDialog}
            />
          )}
        </MobileLayout>

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
            setShowPropertyProjects(false);
          }
        }}>
          <DialogContent className={`max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto border-2 ...`}>
            ... Dialog content preserved for reference ...
          </DialogContent>
        </Dialog>
        */}

        {/* ============================================
            NEW SHEET - Turnover Card Detail
            ============================================ */}
        <Sheet open={!!selectedCard} onOpenChange={(open) => {
          if (!open) {
            setSelectedCard(null);
            setShowAddTaskDialog(false);
            setFullscreenTask(null);
            setShowPropertyProjects(false);
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
                              fullscreenTask.card_actions === 'completed' 
                                ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                : fullscreenTask.card_actions === 'in_progress'
                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                : fullscreenTask.card_actions === 'paused'
                                ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                            }`}
                          >
                            {fullscreenTask.card_actions === 'not_started' ? 'Not Started' :
                             fullscreenTask.card_actions === 'in_progress' ? 'In Progress' :
                             fullscreenTask.card_actions === 'paused' ? 'Paused' :
                             fullscreenTask.card_actions === 'completed' ? 'Completed' :
                             fullscreenTask.card_actions === 'reopened' ? 'Reopened' :
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

                      {/* Action Buttons */}
                      <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
                        <div className="flex flex-wrap gap-2">
                          {(fullscreenTask.card_actions === 'not_started' || !fullscreenTask.card_actions) && (
                            <>
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'in_progress');
                                  setFullscreenTask({ ...fullscreenTask, card_actions: 'in_progress' });
                                }}
                                className="flex-1"
                              >
                                Start Task
                              </Button>
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'completed');
                                  setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                                }}
                                variant="outline"
                                className="flex-1"
                              >
                                Mark Complete
                              </Button>
                            </>
                          )}
                          {fullscreenTask.card_actions === 'in_progress' && (
                            <>
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'paused');
                                  setFullscreenTask({ ...fullscreenTask, card_actions: 'paused' });
                                }}
                                variant="outline"
                                className="flex-1"
                              >
                                Pause
                              </Button>
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'completed');
                                  setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                                }}
                                className="flex-1"
                              >
                                Complete
                              </Button>
                            </>
                          )}
                          {fullscreenTask.card_actions === 'paused' && (
                            <>
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'in_progress');
                                  setFullscreenTask({ ...fullscreenTask, card_actions: 'in_progress' });
                                }}
                                className="flex-1"
                              >
                                Resume
                              </Button>
                              <Button
                                onClick={() => {
                                  updateTaskAction(fullscreenTask.task_id, 'completed');
                                  setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                                }}
                                variant="outline"
                                className="flex-1"
                              >
                                Complete
                              </Button>
                            </>
                          )}
                          {(fullscreenTask.card_actions === 'completed' || fullscreenTask.card_actions === 'reopened') && (
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'not_started');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'not_started' });
                              }}
                              className="w-full"
                            >
                              Reopen Task
                            </Button>
                          )}
                        </div>
                      </div>
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

                          <div className="space-y-2">
                            {selectedCard.tasks.map((task: any) => (
                              <Card 
                                key={task.task_id}
                                className="cursor-pointer hover:shadow-md transition-all"
                                onClick={async (e) => {
                                  if ((e.target as HTMLElement).closest('button')) return;
                                  if (task.template_id && !taskTemplates[task.template_id]) {
                                    await fetchTaskTemplate(task.template_id);
                                  }
                                  setFullscreenTask(task);
                                }}
                              >
                                <CardHeader className="pb-3">
                                  <div className="flex items-center justify-between">
                                    <CardTitle className="text-base flex items-center gap-2">
                                      {task.status === 'complete' ? '✓' : 
                                       task.status === 'in_progress' ? '▶' :
                                       task.status === 'pending' ? '○' : ''}
                                      {task.template_name || 'Unnamed Task'}
                                    </CardTitle>
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant={task.type === 'maintenance' ? 'default' : 'secondary'}
                                        className={`px-2.5 py-1 ${task.type === 'maintenance' 
                                          ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                                          : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                        }`}
                                      >
                                        {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                      </Badge>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500 hover:bg-red-50"
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
                                  <CardDescription>
                                    {task.card_actions === 'not_started' ? 'Not Started' :
                                     task.card_actions === 'in_progress' ? 'In Progress' :
                                     task.card_actions === 'paused' ? 'Paused' :
                                     task.card_actions === 'completed' ? 'Completed' :
                                     task.card_actions === 'reopened' ? 'Reopened' :
                                     'Not Started'}
                                    {task.assigned_staff && ` • ${task.assigned_staff}`}
                                  </CardDescription>
                                </CardHeader>
                              </Card>
                            ))}
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
                            onClick={() => setShowPropertyProjects(!showPropertyProjects)}
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
                              className={`w-5 h-5 text-neutral-500 transition-transform duration-200 ${showPropertyProjects ? 'rotate-180' : ''}`} 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {/* Expandable Content */}
                          {showPropertyProjects && (
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
        </Sheet>

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
          OLD DIALOG DISABLED - To restore, swap Sheet for Dialog
          ============================================ */}
      <Sheet open={!!selectedCard} onOpenChange={(open) => {
        if (!open) {
          setSelectedCard(null);
          setShowAddTaskDialog(false);
          setFullscreenTask(null);
          setShowPropertyProjects(false);
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
                            fullscreenTask.card_actions === 'completed' 
                              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                              : fullscreenTask.card_actions === 'in_progress'
                              ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                              : fullscreenTask.card_actions === 'paused'
                              ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                              : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          {fullscreenTask.card_actions === 'not_started' ? 'Not Started' :
                           fullscreenTask.card_actions === 'in_progress' ? 'In Progress' :
                           fullscreenTask.card_actions === 'paused' ? 'Paused' :
                           fullscreenTask.card_actions === 'completed' ? 'Completed' :
                           fullscreenTask.card_actions === 'reopened' ? 'Reopened' :
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

                    {/* Action Buttons */}
                    <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
                      <div className="flex flex-wrap gap-2">
                        {(fullscreenTask.card_actions === 'not_started' || !fullscreenTask.card_actions) && (
                          <>
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'in_progress');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'in_progress' });
                              }}
                              className="flex-1"
                            >
                              Start Task
                            </Button>
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'completed');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                              }}
                              variant="outline"
                              className="flex-1"
                            >
                              Mark Complete
                            </Button>
                          </>
                        )}
                        {fullscreenTask.card_actions === 'in_progress' && (
                          <>
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'paused');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'paused' });
                              }}
                              variant="outline"
                              className="flex-1"
                            >
                              Pause
                            </Button>
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'completed');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                              }}
                              className="flex-1"
                            >
                              Complete
                            </Button>
                          </>
                        )}
                        {fullscreenTask.card_actions === 'paused' && (
                          <>
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'in_progress');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'in_progress' });
                              }}
                              className="flex-1"
                            >
                              Resume
                            </Button>
                            <Button
                              onClick={() => {
                                updateTaskAction(fullscreenTask.task_id, 'completed');
                                setFullscreenTask({ ...fullscreenTask, card_actions: 'completed' });
                              }}
                              variant="outline"
                              className="flex-1"
                            >
                              Complete
                            </Button>
                          </>
                        )}
                        {(fullscreenTask.card_actions === 'completed' || fullscreenTask.card_actions === 'reopened') && (
                          <Button
                            onClick={() => {
                              updateTaskAction(fullscreenTask.task_id, 'not_started');
                              setFullscreenTask({ ...fullscreenTask, card_actions: 'not_started' });
                            }}
                            className="w-full"
                          >
                            Reopen Task
                          </Button>
                        )}
                      </div>
                    </div>
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

                        <div className="space-y-2">
                          {selectedCard.tasks.map((task: any) => (
                            <Card 
                              key={task.task_id}
                              className="cursor-pointer hover:shadow-md transition-all"
                              onClick={async (e) => {
                                // Don't open fullscreen if clicking delete button
                                if ((e.target as HTMLElement).closest('button')) return;
                                
                                // Fetch template if needed, then open fullscreen
                                if (task.template_id && !taskTemplates[task.template_id]) {
                                  await fetchTaskTemplate(task.template_id);
                                }
                                setFullscreenTask(task);
                              }}
                            >
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-base flex items-center gap-2">
                                    {task.status === 'complete' ? '✓' : 
                                     task.status === 'in_progress' ? '▶' :
                                     task.status === 'pending' ? '○' : ''}
                                    {task.template_name || 'Unnamed Task'}
                                  </CardTitle>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant={task.type === 'maintenance' ? 'default' : 'secondary'}
                                      className={`px-2.5 py-1 ${task.type === 'maintenance' 
                                        ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                                        : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                      }`}
                                    >
                                      {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                    </Badge>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500 hover:bg-red-50"
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
                                <CardDescription>
                                  {task.card_actions === 'not_started' ? 'Not Started' :
                                   task.card_actions === 'in_progress' ? 'In Progress' :
                                   task.card_actions === 'paused' ? 'Paused' :
                                   task.card_actions === 'completed' ? 'Completed' :
                                   task.card_actions === 'reopened' ? 'Reopened' :
                                   'Not Started'}
                                  {task.assigned_staff && ` • ${task.assigned_staff}`}
                                </CardDescription>
                              </CardHeader>
                            </Card>
                          ))}
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
                          onClick={() => setShowPropertyProjects(!showPropertyProjects)}
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
                            className={`w-5 h-5 text-neutral-500 transition-transform duration-200 ${showPropertyProjects ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* Expandable Content */}
                        {showPropertyProjects && (
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
      </Sheet>

    </div>
  );
}

