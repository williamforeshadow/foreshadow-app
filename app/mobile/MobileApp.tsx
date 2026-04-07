'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/authContext';
import { useUsers } from '@/lib/useUsers';
import { useTurnovers } from '@/lib/useTurnovers';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { 
  MobileLayout, 
  MobileTimelineView, 
  MobileMyAssignmentsView,
  MobileProjectsView,
  MobileProjectDetail,
  type MobileTab 
} from '@/components/mobile';
import MessagesWindow from '@/components/windows/MessagesWindow';
import type { Project, Task, TaskTemplate, PropertyOption } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

export default function MobileApp() {
  const { user: currentUser } = useAuth();
  const { users } = useUsers();

  const {
    taskTemplates,
    loadingTaskTemplate,
    fetchTaskTemplate,
    updateTaskAction,
    updateTaskAssignment,
    updateTaskSchedule,
    saveTaskForm,
  } = useTurnovers();

  const binsHook = useProjectBins({ currentUser: currentUser as any });

  // Fetch properties list (replaces projectsHook.allProperties)
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (res.ok && result.properties) {
          setAllProperties(result.properties);
        }
      } catch {}
    })();
  }, []);

  // Mobile-specific state
  const [mobileTab, setMobileTab] = useState<MobileTab>('assignments');
  const [mobileSelectedTask, setMobileSelectedTask] = useState<Task | null>(null);
  const [mobileSelectedProject, setMobileSelectedProject] = useState<Project | null>(null);
  const [mobileRefreshTrigger, setMobileRefreshTrigger] = useState(0);

  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);

  useEffect(() => {
    if ((mobileSelectedTask || mobileSelectedProject) && availableTemplates.length === 0) {
      fetch('/api/tasks').then(r => r.json()).then(result => {
        if (result?.data) setAvailableTemplates(result.data);
      }).catch(() => {});
    }
  }, [mobileSelectedTask, mobileSelectedProject]);

  // Transform Task → Project shape for unified detail panel
  const taskAsProject = useMemo((): Project | null => {
    if (!mobileSelectedTask) return null;
    const task = mobileSelectedTask;
    return {
      id: task.task_id,
      property_id: null,
      property_name: task.property_name || null,
      bin_id: task.bin_id ?? null,
      template_id: task.template_id ?? null,
      template_name: task.template_name ?? null,
      title: task.title || task.template_name || task.type || 'Task',
      description: task.description as any || null,
      status: (task.status as any) || 'not_started',
      priority: (task.priority as any) || 'medium',
      assigned_user_ids: task.assigned_users?.map(u => u.user_id) || [],
      project_assignments: task.assigned_users?.map(u => ({
        user_id: u.user_id,
        user: { id: u.user_id, name: u.name, email: '', role: u.role || 'staff', avatar: u.avatar },
      })) || [],
      department_id: task.department_id || null,
      department_name: task.department_name || null,
      scheduled_date: task.scheduled_date || null,
      scheduled_time: task.scheduled_time || null,
      form_metadata: task.form_metadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, [mobileSelectedTask]);

  const taskTemplate = useMemo((): Template | null => {
    if (!mobileSelectedTask?.template_id) return null;
    const task = mobileSelectedTask;
    const templateId = task.template_id!;
    const cacheKey = task.property_name
      ? `${templateId}__${task.property_name}`
      : templateId;
    return taskTemplates[cacheKey] || taskTemplates[templateId] || null;
  }, [mobileSelectedTask, taskTemplates]);

  const handleSaveTaskAsProject = useCallback(async (projectId: string, fields: any) => {
    const updates: Record<string, unknown> = {};
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.priority !== undefined) updates.priority = fields.priority;
    if (fields.department_id !== undefined) updates.department_id = fields.department_id || null;
    if (fields.scheduled_date !== undefined) {
      await updateTaskSchedule(projectId, fields.scheduled_date || null, fields.scheduled_time || null);
    }
    if (fields.assigned_staff !== undefined) {
      await updateTaskAssignment(projectId, fields.assigned_staff);
    }
    if (fields.status !== undefined) {
      await updateTaskAction(projectId, fields.status);
    }
    if (Object.keys(updates).length > 0) {
      await fetch('/api/update-task-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: projectId, fields: updates }),
      });
    }
    setMobileSelectedTask(prev => {
      if (!prev) return null;
      return {
        ...prev,
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.priority !== undefined && { priority: fields.priority }),
        ...(fields.department_id !== undefined && { department_id: fields.department_id || null }),
        ...(fields.status !== undefined && { status: fields.status }),
        ...(fields.scheduled_date !== undefined && { scheduled_date: fields.scheduled_date || null }),
        ...(fields.scheduled_time !== undefined && { scheduled_time: fields.scheduled_time || null }),
      };
    });
    return taskAsProject;
  }, [updateTaskSchedule, updateTaskAssignment, updateTaskAction, taskAsProject]);

  const handleTaskTemplateChange = useCallback(async (templateId: string | null) => {
    if (!mobileSelectedTask) return;
    await fetch('/api/update-task-fields', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: mobileSelectedTask.task_id, fields: { template_id: templateId } }),
    });
    setMobileSelectedTask(prev => prev ? { ...prev, template_id: templateId || undefined } : null);
    if (templateId) {
      await fetchTaskTemplate(templateId, mobileSelectedTask.property_name);
    }
  }, [mobileSelectedTask, fetchTaskTemplate]);

  const handleSaveTaskForm = useCallback(async (formData: Record<string, unknown>) => {
    if (!mobileSelectedTask) return;
    await saveTaskForm(mobileSelectedTask.task_id, formData);
    setMobileSelectedTask(prev => prev ? { ...prev, form_metadata: formData } : null);
  }, [mobileSelectedTask, saveTaskForm]);

  const handleDeleteTask = useCallback(async (project: Project) => {
    await fetch(`/api/tasks-for-bin/${project.id}`, { method: 'DELETE' });
    setMobileSelectedTask(null);
  }, []);

  // Project overlay handlers (now via tasks-for-bin APIs instead of useProjects)
  const projectTemplate = useMemo((): Template | null => {
    if (!mobileSelectedProject?.template_id) return null;
    const templateId = mobileSelectedProject.template_id;
    const cacheKey = mobileSelectedProject.property_name
      ? `${templateId}__${mobileSelectedProject.property_name}`
      : templateId;
    return taskTemplates[cacheKey] || taskTemplates[templateId] || null;
  }, [mobileSelectedProject, taskTemplates]);

  useEffect(() => {
    if (mobileSelectedProject?.template_id) {
      const templateId = mobileSelectedProject.template_id;
      const cacheKey = mobileSelectedProject.property_name
        ? `${templateId}__${mobileSelectedProject.property_name}`
        : templateId;
      if (!taskTemplates[cacheKey] && !taskTemplates[templateId]) {
        fetchTaskTemplate(templateId, mobileSelectedProject.property_name || undefined);
      }
    }
  }, [mobileSelectedProject?.id]);

  const handleSaveProject = useCallback(async (projectId: string, fields: any) => {
    try {
      const payload: Record<string, unknown> = {};
      if (fields.title !== undefined) payload.title = fields.title;
      if (fields.description !== undefined) payload.description = fields.description || null;
      if (fields.status !== undefined) payload.status = fields.status;
      if (fields.priority !== undefined) payload.priority = fields.priority;
      if (fields.assigned_staff !== undefined) payload.assigned_user_ids = fields.assigned_staff || [];
      if (fields.department_id !== undefined) payload.department_id = fields.department_id || null;
      if (fields.scheduled_date !== undefined) payload.scheduled_date = fields.scheduled_date || null;
      if (fields.scheduled_time !== undefined) payload.scheduled_time = fields.scheduled_time || null;

      const res = await fetch(`/api/tasks-for-bin/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.data) {
        setMobileSelectedProject(result.data);
        return result.data;
      }
    } catch (err) {
      console.error('Error saving project:', err);
    }
    return null;
  }, []);

  const handleDeleteProject = useCallback(async (project: Project) => {
    await fetch(`/api/tasks-for-bin/${project.id}`, { method: 'DELETE' });
    setMobileSelectedProject(null);
  }, []);

  const handleProjectTemplateChange = useCallback(async (templateId: string | null) => {
    if (!mobileSelectedProject) return;
    await fetch(`/api/tasks-for-bin/${mobileSelectedProject.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    setMobileSelectedProject(prev => prev ? { ...prev, template_id: templateId, template_name: null } : null);
    if (templateId) {
      await fetchTaskTemplate(templateId, mobileSelectedProject.property_name || undefined);
    }
  }, [mobileSelectedProject, fetchTaskTemplate]);

  const handleSaveProjectForm = useCallback(async (formData: Record<string, unknown>) => {
    if (!mobileSelectedProject) return;
    await fetch('/api/save-task-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: mobileSelectedProject.id, form_metadata: formData }),
    });
    setMobileSelectedProject(prev => prev ? { ...prev, form_metadata: formData } : null);
  }, [mobileSelectedProject]);

  return (
    <>
      <MobileLayout
        activeTab={mobileTab}
        onTabChange={setMobileTab}
      >
        {mobileTab === 'assignments' && (
          <MobileMyAssignmentsView
            onTaskClick={async (task: any) => {
              const propName = task.property_name;
              const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
              if (task.template_id && !taskTemplates[cacheKey]) {
                await fetchTaskTemplate(task.template_id, propName);
              }
              setMobileSelectedTask({
                ...task,
                assigned_users: [{ user_id: currentUser?.id, name: currentUser?.name }]
              });
            }}
            onProjectClick={async (project: any) => {
              if (project.template_id) {
                const propName = project.property_name;
                const cacheKey = propName ? `${project.template_id}__${propName}` : project.template_id;
                if (!taskTemplates[cacheKey]) {
                  await fetchTaskTemplate(project.template_id, propName);
                }
              }
              setMobileSelectedProject(project);
            }}
            refreshTrigger={mobileRefreshTrigger}
          />
        )}

        {mobileTab === 'projects' && (
          <MobileProjectsView
            users={users}
          />
        )}
        
        {mobileTab === 'timeline' && (
          <MobileTimelineView 
            onCardClick={() => {}}
            refreshTrigger={mobileRefreshTrigger}
            onTaskClick={async (task: any) => {
              const propName = task.property_name;
              const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
              if (task.template_id && !taskTemplates[cacheKey]) {
                await fetchTaskTemplate(task.template_id, propName);
              }
              setMobileSelectedTask(task);
            }}
          />
        )}

        {mobileTab === 'messages' && (
          <MessagesWindow currentUser={currentUser} users={users} />
        )}
      </MobileLayout>

      {/* Task Detail overlay */}
      {mobileSelectedTask && taskAsProject && (
        <MobileProjectDetail
          project={taskAsProject}
          users={users}
          onClose={() => {
            setMobileSelectedTask(null);
            setMobileRefreshTrigger(prev => prev + 1);
          }}
          onSave={handleSaveTaskAsProject}
          onDelete={handleDeleteTask}
          allProperties={allProperties}
          onPropertyChange={async (propertyId, propertyName) => {
            await fetch('/api/update-task-fields', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                task_id: mobileSelectedTask.task_id,
                fields: { property_name: propertyName || null },
              }),
            });
            setMobileSelectedTask(prev => prev ? { ...prev, property_name: propertyName || undefined } : null);
          }}
          bins={binsHook.bins}
          onBinChange={async (binId) => {
            await fetch('/api/update-task-fields', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                task_id: mobileSelectedTask.task_id,
                fields: { bin_id: binId || null },
              }),
            });
            setMobileSelectedTask(prev => prev ? { ...prev, bin_id: binId } : null);
            binsHook.fetchBins();
          }}
          template={taskTemplate}
          formMetadata={mobileSelectedTask.form_metadata}
          onSaveForm={handleSaveTaskForm}
          loadingTemplate={loadingTaskTemplate === mobileSelectedTask.template_id}
          availableTemplates={availableTemplates}
          onTemplateChange={handleTaskTemplateChange}
        />
      )}

      {/* Project Detail overlay (from My Assignments) */}
      {mobileSelectedProject && (
        <MobileProjectDetail
          project={mobileSelectedProject}
          users={users}
          onClose={() => {
            setMobileSelectedProject(null);
            setMobileRefreshTrigger(prev => prev + 1);
          }}
          onSave={handleSaveProject}
          onDelete={handleDeleteProject}
          allProperties={allProperties}
          onPropertyChange={async (propertyId, propertyName) => {
            const res = await fetch(`/api/tasks-for-bin/${mobileSelectedProject.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ property_name: propertyName || null }),
            });
            const result = await res.json();
            if (result.data) {
              setMobileSelectedProject(result.data);
            }
          }}
          bins={binsHook.bins}
          onBinChange={async (binId) => {
            const res = await fetch(`/api/tasks-for-bin/${mobileSelectedProject.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bin_id: binId || null }),
            });
            const result = await res.json();
            if (result.data) {
              setMobileSelectedProject(result.data);
            }
            binsHook.fetchBins();
          }}
          template={projectTemplate}
          formMetadata={mobileSelectedProject.form_metadata as Record<string, unknown> | undefined}
          onSaveForm={handleSaveProjectForm}
          loadingTemplate={loadingTaskTemplate === mobileSelectedProject.template_id}
          availableTemplates={availableTemplates}
          onTemplateChange={handleProjectTemplateChange}
        />
      )}
    </>
  );
}
