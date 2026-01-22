'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/authContext';
import { useUsers } from '@/lib/useUsers';
import { useTurnovers } from '@/lib/useTurnovers';
import { useProjects } from '@/lib/useProjects';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import { 
  MobileLayout, 
  MobileTimelineView, 
  MobileMyAssignmentsView,
  type MobileTab 
} from '@/components/mobile';

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
    saveTaskForm,
  } = useTurnovers();

  // Shared hooks - project functionality
  const {
    allProperties,
    showProjectDialog,
    setShowProjectDialog,
    editingProject,
    projectForm,
    setProjectForm,
    savingProject,
    openEditProjectDialog,
    saveProject,
  } = useProjects({ currentUser });

  // Mobile-specific state
  const [mobileTab, setMobileTab] = useState<MobileTab>('assignments');
  const [mobileSelectedTask, setMobileSelectedTask] = useState<any>(null);
  const [mobileRefreshTrigger, setMobileRefreshTrigger] = useState(0);

  // Reset project form when dialog closes
  const handleProjectDialogClose = (open: boolean) => {
    if (!open) {
      setShowProjectDialog(false);
      setProjectForm({
        property_name: '',
        title: '',
        description: '',
        status: 'not_started',
        priority: 'medium',
        assigned_staff: '',
        scheduled_start: ''
      });
    }
  };

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
              openEditProjectDialog(project);
            }}
            refreshTrigger={mobileRefreshTrigger}
          />
        )}
        
        {mobileTab === 'timeline' && (
          <MobileTimelineView 
            onCardClick={() => {}} // Not used in mobile currently
            refreshTrigger={mobileRefreshTrigger}
            onTaskClick={async (task: any) => {
              // Fetch template if needed, then open task detail
              if (task.template_id && !taskTemplates[task.template_id]) {
                await fetchTaskTemplate(task.template_id);
              }
              setMobileSelectedTask(task);
            }}
            onProjectClick={(project: any) => {
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

      {/* Project Dialog */}
      <Dialog open={showProjectDialog} onOpenChange={handleProjectDialogClose}>
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
              <label className="block text-sm font-medium mb-2">Scheduled Start</label>
              <Input
                type="date"
                value={projectForm.scheduled_start}
                onChange={(e) => setProjectForm({...projectForm, scheduled_start: e.target.value})}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => handleProjectDialogClose(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={saveProject} disabled={savingProject} className="w-full sm:w-auto">
              {savingProject ? 'Saving...' : (editingProject ? 'Update' : 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
