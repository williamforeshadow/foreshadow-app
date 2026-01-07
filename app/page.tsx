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
import TimelineWindow from '@/components/windows/TimelineWindow';
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

  // Fetch projects when viewing projects in mobile turnover detail
  useEffect(() => {
    if (selectedCard && rightPanelView === 'projects' && projects.length === 0) {
      fetchProjects();
    }
  }, [selectedCard, rightPanelView]);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      const result = await response.json();
      if (response.ok && result.data) {
        setProjects(result.data);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
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
                onOpenProjectInWindow={() => {
                  setShowProjectsWindow(true);
                  bringToFront('projects');
                }}
                onCreateProject={() => {
                  setShowProjectsWindow(true);
                  bringToFront('projects');
                }}
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
              <TimelineWindow />
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

    </div>
  );
}

