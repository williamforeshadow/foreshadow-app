'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ChevronDownIcon } from 'lucide-react';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';

export default function StaffPage() {
  const [staffName, setStaffName] = useState('');
  const [cleanings, setCleanings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [currentTemplate, setCurrentTemplate] = useState<any>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [updatingCardAction, setUpdatingCardAction] = useState(false);
  const [showCleaningForm, setShowCleaningForm] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTaskStaff, setEditingTaskStaff] = useState<string | null>(null);
  const [newTaskStaffName, setNewTaskStaffName] = useState('');
  const [taskTemplates, setTaskTemplates] = useState<{[key: string]: any}>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

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

  const fetchMyCleanings = async () => {
    if (!staffName.trim()) {
      setError('Please enter your name');
      return;
    }

    setLoading(true);
    setError(null);
    setCleanings(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_property_turnovers');

      if (rpcError) {
        setError(rpcError.message);
      } else {
        // Filter cleanings for this staff member
        const myCleanings = data?.filter((cleaning: any) => 
          cleaning.assigned_staff?.toLowerCase().includes(staffName.toLowerCase())
        ) || [];
        
        if (myCleanings.length === 0) {
          setError(`No cleanings found for "${staffName}". Check your name spelling.`);
        } else {
          setCleanings(myCleanings);
        }
      }
    } catch (err: any) {
      setError(err.message);
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
      
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => 
          item.id === cleaningId 
            ? { ...item, ...updatedCard }
            : item
        );
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

      // Also update cleanings array (grid view)
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => {
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

      // Also update cleanings array
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => {
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
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update task assignment');
    }
  };

  const getUniqueStaffFromTasks = (): string[] => {
    if (!cleanings) return [];
    const allTasks = cleanings.flatMap((item: any) => item.tasks || []);
    const staff = allTasks
      .map((task: any) => task.assigned_staff)
      .filter((s: any) => s !== null && s !== undefined) as string[];
    return Array.from(new Set(staff)).sort();
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

      // Also update in cleanings array
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => {
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

      // Also update in cleanings array
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => {
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

      // Update cleanings array (grid view)
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => {
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

      // Update cleanings array (grid view)
      setCleanings((prevCleanings: any) => {
        if (!prevCleanings) return prevCleanings;
        
        return prevCleanings.map((item: any) => {
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

  // Use turnover_status for card colors
  const getCardBackgroundColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900';
      case 'in_progress':
        return 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900';
      case 'complete':
        return 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900';
      case 'no_tasks':
        return 'bg-neutral-50/80 dark:bg-neutral-800/30 border-neutral-200 dark:border-neutral-700';
      default:
        return 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700';
    }
  };

  const getSortPriority = (status: string) => {
    switch (status) {
      case 'not_started':
        return 1; // Red - highest priority
      case 'in_progress':
        return 2; // Yellow
      case 'complete':
        return 3; // Green
      case 'no_tasks':
        return 4; // Gray - lowest priority
      default:
        return 5;
    }
  };

  const renderCards = () => {
    if (!cleanings) return null;
    
    let items = [...cleanings].sort((a, b) => {
      const priorityA = getSortPriority(a.turnover_status);
      const priorityB = getSortPriority(b.turnover_status);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      const dateA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
      const dateB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
      
      return dateA - dateB;
    });

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {items.map((item, index) => (
          <Card
            key={item.cleaning_id || item.id || index}
            onClick={() => setSelectedCard(item)}
            className={`cursor-pointer hover:shadow-xl transition-all duration-200 ${getCardBackgroundColor(item.turnover_status)}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{item.property_name || 'Unknown Property'}</CardTitle>
                {/* Task Count Badge */}
                {item.total_tasks > 0 && (
                  <Badge 
                    variant="outline" 
                    className={`shrink-0 text-xs font-semibold ${
                      item.turnover_status === 'complete' 
                        ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                        : item.turnover_status === 'in_progress'
                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 border-yellow-300'
                        : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border-red-300'
                    }`}
                  >
                    {item.completed_tasks || 0}/{item.total_tasks}
                  </Badge>
                )}
              </div>
              <CardDescription className="flex items-center gap-2">
                <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {item.guest_name || <span className="italic opacity-60">No guest</span>}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Dates */}
              <div className="space-y-2.5">
              {/* Checked Out */}
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Checked out</div>
                  <div className="text-sm truncate font-medium text-neutral-900 dark:text-white">
                    {item.check_out ? formatDate(item.check_out) : <span className="italic opacity-60">Not set</span>}
                  </div>
                </div>
              </div>

              {/* Next Check In */}
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Next check in</div>
                  <div className="text-sm truncate font-medium text-neutral-900 dark:text-white">
                    {item.next_check_in ? formatDate(item.next_check_in) : <span className="italic opacity-60">Not set</span>}
                  </div>
                </div>
              </div>

              {/* Occupancy Status */}
              <div className="flex items-center gap-3">
                <svg className={`w-4 h-4 shrink-0 ${item.occupancy_status === 'occupied' ? 'text-orange-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Occupancy</div>
                  <Badge 
                    variant={item.occupancy_status === 'occupied' ? 'default' : 'outline'}
                    className={item.occupancy_status === 'occupied' 
                      ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300'
                    }
                  >
                    {item.occupancy_status === 'occupied' ? 'Occupied' : 'Vacant'}
                  </Badge>
                </div>
              </div>
            </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Sidebar />
      <div className="flex-1 overflow-auto flex items-center justify-center p-8">
        <div className="w-full max-w-6xl">
        <h1 className="text-3xl font-bold mb-8 text-neutral-900 dark:text-white text-center">
          Staff Portal
        </h1>

        {/* Name Input */}
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg border border-neutral-200 dark:border-neutral-800 mb-8">
          <label className="block text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-4">
            What is your name?
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && fetchMyCleanings()}
              placeholder="Enter your name"
              className="flex-1 px-4 py-3 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />
            <Button
              onClick={fetchMyCleanings}
              disabled={loading}
              size="lg"
              className="px-8 text-lg"
            >
              {loading ? 'Loading...' : 'View My Cleanings'}
            </Button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-8">
            <p className="text-sm font-medium text-red-800 dark:text-red-400">Error:</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
          </div>
        )}

        {/* Results */}
        {cleanings !== null && (
          <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
                Your Cleanings ({cleanings.length})
              </h2>
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

            <div className="overflow-auto max-h-96">
              {viewMode === 'cards' ? (
                <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                  {renderCards()}
                </div>
              ) : (
                <div className="p-4 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                  <pre className="text-sm text-neutral-900 dark:text-neutral-100 font-mono whitespace-pre-wrap">
                    {JSON.stringify(cleanings, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
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
                    <DialogTitle className="text-2xl">{selectedCard.property_name || 'Unknown Property'}</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 text-base">
                      <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {selectedCard.guest_name || 'No guest'}
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
                  <svg className={`w-5 h-5 shrink-0 ${selectedCard.occupancy_status === 'occupied' ? 'text-orange-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Occupancy</div>
                    <Badge 
                      variant={selectedCard.occupancy_status === 'occupied' ? 'default' : 'outline'}
                      className={`text-sm ${selectedCard.occupancy_status === 'occupied' 
                        ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300'
                      }`}
                    >
                      {selectedCard.occupancy_status === 'occupied' ? 'Occupied' : 'Vacant'}
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
                            {task.status === 'not_started' ? 'Not Started' :
                             task.status === 'in_progress' ? 'In Progress' :
                             task.status === 'paused' ? 'Paused' :
                             task.status === 'complete' ? 'Completed' :
                             task.status === 'reopened' ? 'Reopened' :
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
                    {expandedTask.status === 'not_started' && (
                      <>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'in_progress')}
                          size="lg"
                          className="flex-1"
                        >
                          Start
                        </Button>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'complete')}
                          size="lg"
                          variant="outline"
                          className="flex-1"
                        >
                          Mark Complete
                        </Button>
                      </>
                    )}
                    {expandedTask.status === 'in_progress' && (
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
                          onClick={() => updateTaskAction(expandedTask.task_id, 'complete')}
                          size="lg"
                          className="flex-1"
                        >
                          Complete
                        </Button>
                      </>
                    )}
                    {expandedTask.status === 'paused' && (
                      <>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'in_progress')}
                          size="lg"
                          className="flex-1"
                        >
                          Resume
                        </Button>
                        <Button
                          onClick={() => updateTaskAction(expandedTask.task_id, 'complete')}
                          size="lg"
                          variant="outline"
                          className="flex-1"
                        >
                          Complete
                        </Button>
                      </>
                    )}
                    {(expandedTask.status === 'complete' || expandedTask.status === 'reopened') && (
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
    </div>
  );
}

