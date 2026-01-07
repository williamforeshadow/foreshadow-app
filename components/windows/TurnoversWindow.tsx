'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import TurnoverCards from '@/components/TurnoverCards';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import { useTurnovers } from '@/lib/useTurnovers';

interface User {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
}

interface TurnoversWindowProps {
  users: User[];
  currentUser: any;
  onOpenProjectInWindow: (project: any) => void;
  onCreateProject: (propertyName?: string) => void;
}

function TurnoversWindowContent({
  users,
  currentUser,
  onOpenProjectInWindow,
  onCreateProject,
}: TurnoversWindowProps) {
  const {
    // Core data
    response,
    error,
    loading,

    // View state
    viewMode,
    setViewMode,
    filters,
    sortBy,

    // Filter functions
    toggleFilter,
    clearAllFilters,
    getActiveFilterCount,

    // Selection
    selectedCard,
    setSelectedCard,
    closeSelectedCard,
    fullscreenTask,
    setFullscreenTask,
    rightPanelView,
    setRightPanelView,

    // Task state
    taskTemplates,
    loadingTaskTemplate,
    availableTemplates,
    showAddTaskDialog,
    setShowAddTaskDialog,

    // Task actions
    updateTaskAction,
    updateTaskAssignment,
    updateTaskSchedule,
    fetchTaskTemplate,
    saveTaskForm,
    fetchAvailableTemplates,
    addTaskToCard,
    deleteTaskFromCard,

    // Projects (for projects tab)
    projects,

    // Turnover project state
    expandedTurnoverProject,
    setExpandedTurnoverProject,
    turnoverProjectFields,
    setTurnoverProjectFields,
    turnoverDiscussionExpanded,
    setTurnoverDiscussionExpanded,
    savingTurnoverProject,
    saveTurnoverProjectChanges,

    // Comments
    projectComments,
    newComment,
    setNewComment,
    postingComment,
    fetchProjectComments,
    postComment,

    // Popover states
    turnoverStaffOpen,
    setTurnoverStaffOpen,

    // Refs
    rightPanelRef,
    scrollPositionRef,
  } = useTurnovers();

  const handleSaveTurnoverProject = () => {
    saveTurnoverProjectChanges();
  };

  return (
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

                  {/* Timeline Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2">
                        Timeline
                        {filters.timeline.length > 0 && (
                          <span className="text-muted-foreground">({filters.timeline.length})</span>
                        )}
                        <ChevronDownIcon className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuCheckboxItemRight
                        checked={filters.timeline.includes('active')}
                        onCheckedChange={() => toggleFilter('timeline', 'active')}
                      >
                        Active
                      </DropdownMenuCheckboxItemRight>
                      <DropdownMenuCheckboxItemRight
                        checked={filters.timeline.includes('upcoming')}
                        onCheckedChange={() => toggleFilter('timeline', 'upcoming')}
                      >
                        Upcoming
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
                        <div className="text-neutral-500 dark:text-neutral-400">In</div>
                        <div className="font-medium text-blue-600 dark:text-blue-400">
                          {selectedCard.check_in ? new Date(selectedCard.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
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
                      {(() => {
                        const checkIn = selectedCard.check_in ? new Date(selectedCard.check_in) : null;
                        const isUpcoming = checkIn && new Date() < checkIn;

                        if (isUpcoming) {
                          return (
                            <Badge
                              variant="outline"
                              className="text-xs px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300 border-dashed"
                            >
                              Upcoming
                            </Badge>
                          );
                        }
                        return (
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
                        );
                      })()}
                    </div>

                    {/* Close Button */}
                    <button
                      onClick={closeSelectedCard}
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
                            onClick={() => onOpenProjectInWindow(expandedTurnoverProject)}
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
                                    {currentUser?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
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
                                          if (expandedTurnoverProject && currentUser) {
                                            postComment(expandedTurnoverProject.id, currentUser.id, newComment);
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
                            onClick={handleSaveTurnoverProject}
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
                                            onOpenProjectInWindow(project);
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
                              onClick={() => onCreateProject(selectedCard.property_name)}
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
                              onClick={() => onCreateProject(selectedCard.property_name)}
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
  );
}

// Wrap with memo to prevent unnecessary re-renders
const TurnoversWindow = memo(TurnoversWindowContent);
export default TurnoversWindow;
