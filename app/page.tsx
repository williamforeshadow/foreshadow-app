'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OpenAI from 'openai';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDownIcon } from 'lucide-react';
import Timeline from '@/components/Timeline';
import FloatingWindow from '@/components/FloatingWindow';
import CleaningForm from '@/components/CleaningForm';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import CleaningCards from '@/components/CleaningCards';
import MaintenanceCards from '@/components/MaintenanceCards';

export default function Home() {
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [naturalQuery, setNaturalQuery] = useState('');
  const [generatedSQL, setGeneratedSQL] = useState('');
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
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
  const [maintenanceFilters, setMaintenanceFilters] = useState({
    priority: [] as string[],
    cardActions: [] as string[],
    staff: [] as string[],
    property: [] as string[]
  });
  const [maintenanceSortBy, setMaintenanceSortBy] = useState('priority-high');
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);
  const [showQueryWindow, setShowQueryWindow] = useState(false);
  const [showProjectsWindow, setShowProjectsWindow] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<1 | 2>(1);
  const [activeWindow, setActiveWindow] = useState<'cards' | 'timeline' | 'query' | 'projects'>('cards');
  const [windowOrder, setWindowOrder] = useState<Array<'cards' | 'timeline' | 'query' | 'projects'>>(['cards', 'timeline', 'query', 'projects']);
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
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTaskStaff, setEditingTaskStaff] = useState<string | null>(null);
  const [newTaskStaffName, setNewTaskStaffName] = useState('');
  const [taskTemplates, setTaskTemplates] = useState<{[key: string]: any}>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [cardViewMode, setCardViewMode] = useState<'cleanings' | 'maintenance'>('cleanings');
  const [maintenanceCards, setMaintenanceCards] = useState<any[]>([]);
  const [showCreateMaintenance, setShowCreateMaintenance] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    property_name: 'none',
    title: '',
    description: '',
    assigned_staff: '',
    scheduled_start: '',
    priority: 'medium'
  });
  const [creatingMaintenance, setCreatingMaintenance] = useState(false);

  // Window stacking order management
  const bringToFront = (window: 'cards' | 'timeline' | 'query' | 'projects') => {
    setActiveWindow(window);
    setWindowOrder(prev => {
      const filtered = prev.filter(w => w !== window);
      return [...filtered, window]; // Move window to end (top of stack)
    });
  };

  const getZIndex = (window: 'cards' | 'timeline' | 'query' | 'projects') => {
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

  const fetchMaintenanceCards = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_maintenance_cards');
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setMaintenanceCards(data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch maintenance cards');
    } finally {
      setLoading(false);
    }
  };

  const createMaintenance = async () => {
    if (!maintenanceForm.title.trim()) {
      setError('Title is required');
      return;
    }

    setCreatingMaintenance(true);
    setError(null);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...maintenanceForm,
          property_name: maintenanceForm.property_name === 'none' ? null : maintenanceForm.property_name
        })
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        // Refresh maintenance cards
        await fetchMaintenanceCards();
        // Reset form and close dialog
        setMaintenanceForm({
          property_name: 'none',
          title: '',
          description: '',
          assigned_staff: '',
          scheduled_start: '',
          priority: 'medium'
        });
        setShowCreateMaintenance(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create maintenance card');
    } finally {
      setCreatingMaintenance(false);
    }
  };

  const executeNaturalQuery = async () => {
    setIsExecutingQuery(true);
    setError(null);
    setResponse(null);
    setGeneratedSQL('');
    setAiSummary(null);
    
    try {
      const res = await fetch('/api/sql-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: naturalQuery })
      });
      
      const result = await res.json();
      
      if (result.error) {
        setError(`SQL Error: ${result.error}\n\nGenerated SQL:\n${result.sql || 'N/A'}`);
      } else {
        setGeneratedSQL(result.sql);
        setResponse(result.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const generateAISummary = async () => {
    if (!response) return;
    
    setIsGeneratingSummary(true);
    setAiSummary(null);
    
    try {
      const openai = new OpenAI({
        apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        dangerouslyAllowBrowser: true // Note: In production, call OpenAI from a server route
      });
  
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that summarizes property cleaning and reservation data in a clear, concise, and natural way. Focus on key information like property names, dates, guest names, and status."
          },
          {
            role: "user",
            content: `Please summarize this data in natural language:\n\n${JSON.stringify(response, null, 2)}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
  
      const summary = completion.choices[0]?.message?.content || 'No summary generated';
      setAiSummary(summary);
      
      // Automatically speak the summary
      speakText(summary);
      
    } catch (err: any) {
      setError(`AI Summary Error: ${err.message}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };
  
  const speakText = (text: string) => {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    if (!text) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  };
  
  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
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

  const updateMaintenanceAction = async (maintenanceId: string, newAction: string) => {
    setUpdatingCardAction(true);
    try {
      const response = await fetch('/api/update-maintenance-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenanceId, action: newAction })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update maintenance action');
      }

      // Update the local state
      const updatedCard = result.data;
      
      setMaintenanceCards((prevCards: any[]) => 
        prevCards.map((card: any) => 
          card.id === maintenanceId 
            ? { ...card, ...updatedCard }
            : card
        )
      );

      // Also update the selected card if still open
      setSelectedCard((prev: any) => 
        prev?.id === maintenanceId 
          ? { ...prev, ...updatedCard }
          : prev
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update maintenance action');
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

      // If the deleted task was expanded, collapse it
      if (expandedTaskId === taskId) {
        setExpandedTaskId(null);
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

  const toggleMaintenanceFilter = (category: keyof typeof maintenanceFilters, value: string) => {
    setMaintenanceFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value]
    }));
  };

  const clearAllFilters = () => {
    if (cardViewMode === 'cleanings') {
      setFilters({
        cleanStatus: [],
        cardActions: [],
        staff: []
      });
    } else {
      setMaintenanceFilters({
        priority: [],
        cardActions: [],
        staff: [],
        property: []
      });
    }
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
    return cardViewMode === 'cleanings'
      ? filters.cleanStatus.length + filters.cardActions.length + filters.staff.length
      : maintenanceFilters.priority.length + maintenanceFilters.cardActions.length + maintenanceFilters.staff.length + maintenanceFilters.property.length;
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

  const renderCardsSection = () => {
    if (cardViewMode === 'cleanings') {
      const cleaningsData = response ? (Array.isArray(response) ? response : [response]) : [];
      return (
        <CleaningCards
          data={cleaningsData}
          filters={filters}
          sortBy={sortBy}
          onCardClick={setSelectedCard}
        />
      );
    } else {
      return (
        <MaintenanceCards
          data={maintenanceCards}
          filters={maintenanceFilters}
          sortBy={maintenanceSortBy}
          onCardClick={setSelectedCard}
        />
      );
    }
  };

  // Memoize window contents to prevent re-renders when only z-index changes
  const cardsWindowContent = useMemo(() => (
    <div className="p-6 space-y-4">
      {/* Card Type Toggle */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant={cardViewMode === 'cleanings' ? 'default' : 'outline'}
          onClick={() => {
            setCardViewMode('cleanings');
            if (!response) {
              quickCall('get_property_turnovers');
            }
          }}
          size="sm"
        >
          Cleanings
        </Button>
        <Button
          variant={cardViewMode === 'maintenance' ? 'default' : 'outline'}
          onClick={() => {
            setCardViewMode('maintenance');
            fetchMaintenanceCards();
          }}
          size="sm"
        >
          Maintenance
        </Button>
        
        {/* Create Maintenance Button - only show in maintenance mode */}
        {cardViewMode === 'maintenance' && (
          <Button
            onClick={() => setShowCreateMaintenance(true)}
            size="sm"
            className="ml-auto"
          >
            + Create Maintenance
          </Button>
        )}
      </div>

      {/* Response Display */}
      {((cardViewMode === 'cleanings' && response !== null) || (cardViewMode === 'maintenance' && maintenanceCards.length > 0)) && (
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
                  {cardViewMode === 'cleanings' ? (
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
                  ) : (
                    <Select value={maintenanceSortBy} onValueChange={setMaintenanceSortBy}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority-high">Priority: High First</SelectItem>
                        <SelectItem value="status-priority">Status Priority</SelectItem>
                        <SelectItem value="scheduled-soonest">Scheduled: Soonest</SelectItem>
                        <SelectItem value="created-newest">Created: Newest</SelectItem>
                        <SelectItem value="created-oldest">Created: Oldest</SelectItem>
                        <SelectItem value="property-az">Property Name: A-Z</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-3 border-t border-neutral-200 dark:border-neutral-800">
                {/* Clean Status - Only for cleanings */}
                {cardViewMode === 'cleanings' && (
                  <div>
                    <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">Clean Status</h4>
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
                )}

                {/* Priority - Only for maintenance */}
                {cardViewMode === 'maintenance' && (
                  <div>
                    <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">Priority</h4>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('urgent')}
                          onChange={() => toggleMaintenanceFilter('priority', 'urgent')}
                          className="rounded border-neutral-300"
                        />
                        <span>Urgent</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('high')}
                          onChange={() => toggleMaintenanceFilter('priority', 'high')}
                          className="rounded border-neutral-300"
                        />
                        <span>High</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('medium')}
                          onChange={() => toggleMaintenanceFilter('priority', 'medium')}
                          className="rounded border-neutral-300"
                        />
                        <span>Medium</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('low')}
                          onChange={() => toggleMaintenanceFilter('priority', 'low')}
                          className="rounded border-neutral-300"
                        />
                        <span>Low</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Card Actions */}
                <div>
                  <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">Card Actions</h4>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('not_started') : maintenanceFilters.cardActions.includes('not_started')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'not_started') : toggleMaintenanceFilter('cardActions', 'not_started')}
                        className="rounded border-neutral-300"
                      />
                      <span>Not Started</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('in_progress') : maintenanceFilters.cardActions.includes('in_progress')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'in_progress') : toggleMaintenanceFilter('cardActions', 'in_progress')}
                        className="rounded border-neutral-300"
                      />
                      <span>In Progress</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('paused') : maintenanceFilters.cardActions.includes('paused')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'paused') : toggleMaintenanceFilter('cardActions', 'paused')}
                        className="rounded border-neutral-300"
                      />
                      <span>Paused</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('completed') : maintenanceFilters.cardActions.includes('completed')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'completed') : toggleMaintenanceFilter('cardActions', 'completed')}
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
                        checked={cardViewMode === 'cleanings' ? filters.staff.includes('unassigned') : maintenanceFilters.staff.includes('unassigned')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('staff', 'unassigned') : toggleMaintenanceFilter('staff', 'unassigned')}
                        className="rounded border-neutral-300"
                      />
                      <span>Unassigned</span>
                    </label>
                    {cardViewMode === 'cleanings' && response && getUniqueStaff(Array.isArray(response) ? response : [response]).map(staff => (
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
                    {cardViewMode === 'maintenance' && maintenanceCards && getUniqueStaff(maintenanceCards).map(staff => (
                      <label key={staff} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.staff.includes(staff)}
                          onChange={() => toggleMaintenanceFilter('staff', staff)}
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
              {cardViewMode === 'cleanings' ? (
                <>Cleanings: {Array.isArray(response) ? response.length : 1} total</>
              ) : (
                <>Maintenance: {maintenanceCards.length} total</>
              )}
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
                {renderCardsSection()}
              </div>
            ) : (
              <div className="p-4 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                <pre className="text-sm text-neutral-900 dark:text-neutral-100 font-mono whitespace-pre-wrap">
                  {JSON.stringify(cardViewMode === 'cleanings' ? response : maintenanceCards, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  ), [response, viewMode, showFilters, filters, sortBy, cardViewMode, maintenanceCards, maintenanceFilters, maintenanceSortBy]);

  const timelineWindowContent = useMemo(() => (
    <Timeline onCardClick={setSelectedCard} />
  ), []);

  const queryWindowContent = useMemo(() => (
    <div className="p-6 space-y-4">
      {/* Natural Language Query Section */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
          Natural Language Query
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={naturalQuery}
            onChange={(e) => setNaturalQuery(e.target.value)}
            placeholder="e.g., show me all cleanings for next week"
            className="flex-1 px-4 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
            onKeyDown={(e) => e.key === 'Enter' && executeNaturalQuery()}
          />
          <Button
            onClick={executeNaturalQuery}
            disabled={isExecutingQuery || !naturalQuery.trim()}
          >
            {isExecutingQuery ? 'Executing...' : 'Execute'}
          </Button>
        </div>
        
        {generatedSQL && (
          <div className="p-3 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
            <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">Generated SQL:</p>
            <pre className="text-xs text-neutral-900 dark:text-white font-mono overflow-x-auto">
              {generatedSQL}
            </pre>
          </div>
        )}
      </div>

      {/* AI Summary Section */}
      {response !== null && (
        <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              🤖 AI Summary
            </h3>
            <div className="flex gap-2">
              <button
                onClick={generateAISummary}
                disabled={isGeneratingSummary || isSpeaking}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:bg-neutral-400 disabled:cursor-not-allowed transition-colors"
              >
                {isGeneratingSummary ? '🔄 Generating...' : '✨ Generate Summary'}
              </button>
              
              {isSpeaking && (
                <button
                  onClick={stopSpeaking}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  🔇 Stop Speaking
                </button>
              )}
            </div>
          </div>
          
          {aiSummary && (
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">
                  {isSpeaking ? '🔊' : '💬'}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-neutral-900 dark:text-white leading-relaxed">
                    {aiSummary}
                  </p>
                  <button
                    onClick={() => speakText(aiSummary)}
                    disabled={isSpeaking}
                    className="mt-3 text-xs text-purple-600 dark:text-purple-400 hover:underline disabled:opacity-50"
                  >
                    🔊 Read again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  ), [naturalQuery, isExecutingQuery, generatedSQL, response, aiSummary, isGeneratingSummary, isSpeaking]);

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
    <div className="p-4 space-y-4 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
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
              
              {/* Projects Grid - ROI UI Task Cards */}
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr">
                {propertyProjects.map((project: any) => (
                  <Card 
                    key={project.id} 
                    className="group w-full gap-4 !p-4 hover:shadow-lg transition-all duration-200 !flex !flex-col"
                  >
                    <CardHeader className="min-h-[4.5rem]">
                      <CardTitle className="text-base leading-tight line-clamp-2">{project.title}</CardTitle>
                      <CardDescription className="line-clamp-2 text-muted-foreground">
                        {project.description || '\u00A0'}
                      </CardDescription>
                      <CardAction>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEditProjectDialog(project)}
                            className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-md transition-colors"
                          >
                            <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteProject(project)}
                            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                          >
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </CardAction>
                    </CardHeader>

                    <CardContent className="flex-grow">
                      <div className="flex w-full items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge 
                            className={`text-xs ${
                              project.priority === 'urgent' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' :
                              project.priority === 'high' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800' :
                              project.priority === 'medium' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                              'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                            }`}
                          >
                            {project.priority}
                          </Badge>
                          <Badge 
                            className={`text-xs ${
                              project.status === 'complete' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800' :
                              project.status === 'in_progress' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                              project.status === 'on_hold' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800' :
                              'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                            }`}
                          >
                            {project.status?.replace('_', ' ') || 'not started'}
                          </Badge>
                        </div>
                        {/* Avatar placeholder for assigned staff */}
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
  ), [projects, loadingProjects, groupedProjects, showProjectDialog, editingProject, projectForm, savingProject, allProperties]);

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
                variant={showCardsWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Cards
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
                variant={showTimelineWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Timeline
              </Button>
              <Button
                onClick={() => {
                  if (showQueryWindow) {
                    setShowQueryWindow(false);
                  } else {
                    setShowQueryWindow(true);
                    bringToFront('query');
                  }
                }}
                variant={showQueryWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Query
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
                variant={showProjectsWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
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
          {/* Cards Window */}
          {showCardsWindow && (
            <FloatingWindow
              id="cards"
              title="Cards View"
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

          {/* Query Window */}
          {showQueryWindow && (
            <FloatingWindow
              id="query"
              title="Natural Language Query"
              defaultPosition={{ x: 250, y: 250 }}
              defaultSize={{ width: '60%', height: '70%' }}
              zIndex={getZIndex('query')}
              onClose={() => setShowQueryWindow(false)}
              onFocus={() => bringToFront('query')}
            >
              {queryWindowContent}
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
            className="absolute bottom-4 right-4 p-2 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-sm border border-white/10 transition-all duration-200 opacity-40 hover:opacity-100 z-50"
            title={`Switch to background ${backgroundImage === 1 ? '2' : '1'}`}
          >
            <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Card Detail Modal */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => {
        if (!open) {
          setSelectedCard(null);
          setShowAddTaskDialog(false);
          setExpandedTaskId(null);
        }
      }}>
        <DialogContent
          className={`max-w-md max-h-[90vh] overflow-y-auto border-2 ${
            selectedCard?.turnover_status === 'not_started' ? 'border-red-400' :
            selectedCard?.turnover_status === 'in_progress' ? 'border-yellow-400' :
            selectedCard?.turnover_status === 'complete' ? 'border-emerald-400' :
            'border-neutral-300'
          }`}
        >
          {selectedCard && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <DialogTitle className="text-2xl">
                      {selectedCard.title || selectedCard.property_name || 'Unknown'}
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2 text-base">
                      {/* Show guest name for cleanings, description for maintenance */}
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
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4">
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
                      className={`text-sm ${
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
                      Click a task to expand
                    </div>
                  </div>

                  <div className="space-y-2">
                    {selectedCard.tasks.map((task: any) => (
                      <Card 
                        key={task.task_id}
                        className="cursor-pointer hover:shadow-md transition-all"
                        onClick={async (e) => {
                          // Don't expand if clicking delete button
                          if ((e.target as HTMLElement).closest('button')) return;
                          
                          const newExpandedId = expandedTaskId === task.task_id ? null : task.task_id;
                          setExpandedTaskId(newExpandedId);
                          
                          // Fetch template if expanding and template exists
                          if (newExpandedId && task.template_id && !taskTemplates[task.template_id]) {
                            await fetchTaskTemplate(task.template_id);
                          }
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
                                className={task.type === 'maintenance' 
                                  ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                                  : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                }
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

                        {expandedTaskId === task.task_id && (
                          <CardContent className="pt-0 space-y-4" onClick={(e) => e.stopPropagation()}>
                            {/* Staff Assignment */}
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                                Assigned Staff
                              </label>
                              {editingTaskStaff === task.task_id ? (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-2">
                                    <select
                                      className="flex-1 px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
                                      onChange={(e) => {
                                        if (e.target.value === 'new') {
                                          setNewTaskStaffName('');
                                        } else {
                                          updateTaskAssignment(task.task_id, e.target.value || null);
                                          setEditingTaskStaff(null);
                                        }
                                      }}
                                      value={task.assigned_staff || ''}
                                    >
                                      <option value="">Unassigned</option>
                                      {getUniqueStaffFromTasks().map(staff => (
                                        <option key={staff} value={staff}>{staff}</option>
                                      ))}
                                      <option value="new">+ Add New Staff...</option>
                                    </select>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setEditingTaskStaff(null)}
                                    >
                                      ✕
                                    </Button>
                                  </div>
                                  {newTaskStaffName !== undefined && (
                                    <div className="flex gap-2">
                                      <input
                                        type="text"
                                        placeholder="Enter staff name..."
                                        value={newTaskStaffName}
                                        onChange={(e) => setNewTaskStaffName(e.target.value)}
                                        className="flex-1 px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg"
                                      />
                                      <Button
                                        onClick={() => {
                                          if (newTaskStaffName.trim()) {
                                            updateTaskAssignment(task.task_id, newTaskStaffName.trim());
                                            setEditingTaskStaff(null);
                                            setNewTaskStaffName('');
                                          }
                                        }}
                                        disabled={!newTaskStaffName.trim()}
                                        size="sm"
                                      >
                                        Save
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditingTaskStaff(task.task_id)}
                                  className="w-full justify-start"
                                >
                                  {task.assigned_staff || 'Click to assign staff'}
                                </Button>
                              )}
                            </div>

                            {/* Scheduled Date/Time */}
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                                Scheduled For
                              </label>
                              <div className="flex gap-2">
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className="w-40 justify-between font-normal"
                                      size="sm"
                                    >
                                      {task.scheduled_start 
                                        ? new Date(task.scheduled_start).toLocaleDateString() 
                                        : "Select date"}
                                      <ChevronDownIcon className="h-4 w-4" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                      mode="single"
                                      selected={task.scheduled_start ? new Date(task.scheduled_start) : undefined}
                                      onSelect={(date) => {
                                        if (date) {
                                          const timeStr = task.scheduled_start 
                                            ? new Date(task.scheduled_start).toTimeString().slice(0, 5) 
                                            : '09:00';
                                          const dateStr = date.toISOString().split('T')[0];
                                          updateTaskSchedule(task.task_id, `${dateStr}T${timeStr}:00`);
                                        } else {
                                          updateTaskSchedule(task.task_id, null);
                                        }
                                      }}
                                    />
                                  </PopoverContent>
                                </Popover>
                                
                                <Input
                                  type="time"
                                  value={task.scheduled_start ? new Date(task.scheduled_start).toTimeString().slice(0, 5) : ""}
                                  onChange={(e) => {
                                    if (task.scheduled_start) {
                                      const dateStr = new Date(task.scheduled_start).toISOString().split('T')[0];
                                      updateTaskSchedule(task.task_id, `${dateStr}T${e.target.value}:00`);
                                    } else {
                                      const today = new Date().toISOString().split('T')[0];
                                      updateTaskSchedule(task.task_id, `${today}T${e.target.value}:00`);
                                    }
                                  }}
                                  className="w-32"
                                />
                              </div>
                            </div>

                            {/* Template Form */}
                            {task.template_id && (
                              <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
                                {loadingTaskTemplate === task.template_id ? (
                                  <div className="flex items-center justify-center py-4">
                                    <p className="text-sm text-neutral-500">Loading form...</p>
                                  </div>
                                ) : taskTemplates[task.template_id] ? (
                                  <DynamicCleaningForm
                                    cleaningId={task.task_id}
                                    propertyName={selectedCard.property_name}
                                    template={taskTemplates[task.template_id]}
                                    formMetadata={task.form_metadata}
                                    onSave={async (formData) => {
                                      await saveTaskForm(task.task_id, formData);
                                    }}
                                  />
                                ) : (
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                                    No template configured
                                  </p>
                                )}
                              </div>
                            )}
                          </CardContent>
                        )}
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
                    <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Task
                  </Button>

                  {/* Add Task Dialog */}
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
                    <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Task
                  </Button>
                  
                  {/* Add Task Dialog (when no tasks exist) */}
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

            </div>

            {/* Task Action Buttons - Show when task is expanded */}
            {expandedTaskId && selectedCard.tasks && selectedCard.tasks.length > 0 && (() => {
              const expandedTask = selectedCard.tasks.find((t: any) => t.task_id === expandedTaskId);
              return expandedTask ? (
                <div className="px-6 py-4 border-t border-neutral-200 dark:border-neutral-700">
                  <div className="flex flex-wrap gap-2">
                    {expandedTask.card_actions === 'not_started' && (
                      <>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'in_progress')}
                          size="lg"
                          className="flex-1"
                        >
                          Start
                        </Button>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'completed')}
                          size="lg"
                          variant="outline"
                          className="flex-1"
                        >
                          Mark Complete
                        </Button>
                      </>
                    )}
                    {expandedTask.card_actions === 'in_progress' && (
                      <>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'paused')}
                          size="lg"
                          variant="outline"
                          className="flex-1"
                        >
                          Pause
                        </Button>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'completed')}
                          size="lg"
                          className="flex-1"
                        >
                          Complete
                        </Button>
                      </>
                    )}
                    {expandedTask.card_actions === 'paused' && (
                      <>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'in_progress')}
                          size="lg"
                          className="flex-1"
                        >
                          Resume
                        </Button>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'completed')}
                          size="lg"
                          variant="outline"
                          className="flex-1"
                        >
                          Complete
                        </Button>
                      </>
                    )}
                    {(expandedTask.card_actions === 'completed' || expandedTask.card_actions === 'reopened') && (
                      <Button
                        onClick={() => updateTaskAction(expandedTask.task_id, 'not_started')}
                        size="lg"
                        className="w-full"
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ) : null;
            })()}

            <DialogFooter className="border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setSelectedCard(null)}
                className="w-full"
              >
                Close
              </Button>
            </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Maintenance Dialog */}
      <Dialog open={showCreateMaintenance} onOpenChange={setShowCreateMaintenance}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Maintenance Card</DialogTitle>
            <DialogDescription>
              Create a new maintenance task for a property or general item.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Property */}
            <div>
              <label className="block text-sm font-medium mb-2">Property (Optional)</label>
              <Select
                value={maintenanceForm.property_name}
                onValueChange={(value) => setMaintenanceForm({...maintenanceForm, property_name: value})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select property or leave blank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (General)</SelectItem>
                  {allProperties.map((property) => (
                    <SelectItem key={property} value={property}>
                      {property}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium mb-2">Title *</label>
              <input
                type="text"
                value={maintenanceForm.title}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, title: e.target.value})}
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"
                placeholder="e.g., Fix leaky faucet"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={maintenanceForm.description}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, description: e.target.value})}
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white min-h-[80px]"
                placeholder="Additional details..."
              />
            </div>

            {/* Assigned Staff */}
            <div>
              <label className="block text-sm font-medium mb-2">Assigned Staff</label>
              <input
                type="text"
                value={maintenanceForm.assigned_staff}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, assigned_staff: e.target.value})}
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"
                placeholder="Staff member name"
              />
            </div>

            {/* Scheduled Start */}
            <div>
              <label className="block text-sm font-medium mb-2">Scheduled Start</label>
              <input
                type="datetime-local"
                value={maintenanceForm.scheduled_start}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, scheduled_start: e.target.value})}
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium mb-2">Priority</label>
              <Select
                value={maintenanceForm.priority}
                onValueChange={(value) => setMaintenanceForm({...maintenanceForm, priority: value})}
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

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateMaintenance(false)}
              disabled={creatingMaintenance}
            >
              Cancel
            </Button>
            <Button
              onClick={createMaintenance}
              disabled={creatingMaintenance}
            >
              {creatingMaintenance ? 'Creating...' : 'Create Maintenance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

