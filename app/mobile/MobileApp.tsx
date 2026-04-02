'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/authContext';
import { useUsers } from '@/lib/useUsers';
import { useTurnovers } from '@/lib/useTurnovers';
import { useProjects } from '@/lib/useProjects';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { 
  MobileLayout, 
  MobileTimelineView, 
  MobileMyAssignmentsView,
  MobileProjectsView,
  MobileProjectDetail,
  MobileTaskDetail,
  type MobileTab 
} from '@/components/mobile';
import MessagesWindow from '@/components/windows/MessagesWindow';
import type { Project, Task } from '@/lib/types';

export default function MobileApp() {
  // Core hooks
  const { user: currentUser } = useAuth();
  const { users } = useUsers();

  // Shared hooks - task functionality
  const {
    taskTemplates,
    loadingTaskTemplate,
    fetchTaskTemplate,
    updateTaskAction,
    updateTaskAssignment,
    updateTaskSchedule,
    saveTaskForm,
  } = useTurnovers();

  // Shared hooks - project functionality
  const projectsHook = useProjects({ currentUser });
  const { allProperties } = projectsHook;
  const binsHook = useProjectBins({ currentUser: currentUser as any });

  // Mobile-specific state
  const [mobileTab, setMobileTab] = useState<MobileTab>('assignments');
  const [mobileSelectedTask, setMobileSelectedTask] = useState<Task | null>(null);
  const [mobileSelectedProject, setMobileSelectedProject] = useState<Project | null>(null);
  const [mobileRefreshTrigger, setMobileRefreshTrigger] = useState(0);

  const handleTaskScheduleUpdate = useCallback(async (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => {
    await updateTaskSchedule(taskId, scheduledDate, scheduledTime);
  }, [updateTaskSchedule]);

  const handleTaskAssignmentUpdate = useCallback(async (taskId: string, userIds: string[]) => {
    await updateTaskAssignment(taskId, userIds);
  }, [updateTaskAssignment]);

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
              const propName = task.property_name;
              const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
              if (task.template_id && !taskTemplates[cacheKey]) {
                await fetchTaskTemplate(task.template_id, propName);
              }
              // Add current user to assigned_users since this task came from My Work (they're assigned)
              setMobileSelectedTask({
                ...task,
                assigned_users: [{ user_id: currentUser?.id, name: currentUser?.name }]
              });
            }}
            onProjectClick={(project: any) => {
              setMobileSelectedProject(project);
            }}
            refreshTrigger={mobileRefreshTrigger}
          />
        )}

        {mobileTab === 'projects' && (
          <MobileProjectsView
            users={users}
            projectsHook={projectsHook}
          />
        )}
        
        {mobileTab === 'timeline' && (
          <MobileTimelineView 
            onCardClick={() => {}} // Not used in mobile currently
            refreshTrigger={mobileRefreshTrigger}
            onTaskClick={async (task: any) => {
              // Fetch template if needed, then open task detail
              const propName = task.property_name;
              const cacheKey = propName ? `${task.template_id}__${propName}` : task.template_id;
              if (task.template_id && !taskTemplates[cacheKey]) {
                await fetchTaskTemplate(task.template_id, propName);
              }
              setMobileSelectedTask(task);
            }}
            onProjectClick={(project: any) => {
              setMobileSelectedProject(project);
            }}
          />
        )}

        {mobileTab === 'messages' && (
          <MessagesWindow currentUser={currentUser} users={users} />
        )}
      </MobileLayout>

      {/* Mobile Task Detail - Full Screen Takeover */}
      {mobileSelectedTask && (
        <MobileTaskDetail
          task={mobileSelectedTask}
          users={users}
          onClose={() => {
            setMobileSelectedTask(null);
            setMobileRefreshTrigger(prev => prev + 1);
          }}
          onUpdateStatus={updateTaskAction}
          onSaveForm={saveTaskForm}
          taskTemplates={taskTemplates}
          loadingTaskTemplate={loadingTaskTemplate}
          onUpdateSchedule={handleTaskScheduleUpdate}
          onUpdateAssignment={handleTaskAssignmentUpdate}
        />
      )}

      {/* Mobile Project Detail - Full Screen Takeover */}
      {mobileSelectedProject && (
        <MobileProjectDetail
          project={mobileSelectedProject}
          users={users}
          onClose={() => {
            setMobileSelectedProject(null);
            setMobileRefreshTrigger(prev => prev + 1);
          }}
          onSave={projectsHook.saveProjectById}
          onDelete={(project) => {
            projectsHook.deleteProject(project);
            setMobileSelectedProject(null);
          }}
          allProperties={allProperties}
          onPropertyChange={async (propertyId, propertyName) => {
            await projectsHook.updateProjectField(mobileSelectedProject.id, 'property_id', propertyId || '');
            if (propertyName !== undefined) {
              await projectsHook.updateProjectField(mobileSelectedProject.id, 'property_name', propertyName || '');
            }
            setMobileSelectedProject(prev => prev ? {
              ...prev,
              property_id: propertyId,
              property_name: propertyName,
            } : null);
          }}
          bins={binsHook.bins}
          onBinChange={async (binId, _binName) => {
            await projectsHook.updateProjectField(mobileSelectedProject.id, 'bin_id', binId || '');
            setMobileSelectedProject(prev => prev ? {
              ...prev,
              bin_id: binId,
            } : null);
            binsHook.fetchBins();
          }}
        />
      )}
    </>
  );
}
