'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput } from '@/components/tasks/detail/taskInput';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';
import { qk } from '@/lib/queries';
import type { Project, User } from '@/lib/types';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import { tiptapToPlainText, tiptapHasContent } from '@/lib/utils';
import { taskPath } from '@/src/lib/links';

interface TurnoverProjectsPanelProps {
  propertyName: string;
  projects: Project[];
  users: User[];
  /**
   * Pop-out icon on each card — opens the project in the Projects window.
   * Unrelated to the detail panel below.
   */
  onOpenProjectInWindow: (project: Project) => void;
}

function ProjectCard({
  project,
  deptIconMap,
  onClick,
  onOpenInWindow,
}: {
  project: Project;
  deptIconMap: Record<string, string | undefined>;
  onClick: () => void;
  onOpenInWindow: (project: Project) => void;
}) {
  const DeptIcon = getDepartmentIcon(project.department_id ? deptIconMap[project.department_id] : null);

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-card border"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <DeptIcon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
            <CardTitle className="text-base truncate">{project.title}</CardTitle>
            {/* Pop-out icon to open in Projects window */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenInWindow(project);
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
        {tiptapHasContent(project.description) && (
          <CardDescription className="text-sm line-clamp-2 mt-1">
            {tiptapToPlainText(project.description)}
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
              project.status === 'paused' ? 'bg-red-100 text-red-700 border-red-300' :
              'bg-neutral-100 text-neutral-600 border-neutral-300'
            }`}
          >
            {project.status === 'not_started' ? 'Not Started' :
             project.status === 'in_progress' ? 'In Progress' :
             project.status === 'complete' ? 'Complete' :
             project.status === 'paused' ? 'Paused' : project.status}
          </Badge>
          {project.scheduled_date && (
            <span className="text-neutral-500">
              Start: {new Date(project.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {project.scheduled_time && ` @ ${project.scheduled_time.slice(0, 5)}`}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function TurnoverProjectsPanel({
  propertyName,
  projects,
  users,
  onOpenProjectInWindow,
}: TurnoverProjectsPanelProps) {
  const propertyProjects = projects.filter(p => p.property_name === propertyName);
  const { deptIconMap } = useDepartments();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Selection is local — the "Property Projects" tab unmounts this component
  // whenever the turnover panel closes or the tab switches away, so this
  // resets for free rather than needing to be reached in from the parent.
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [creatingOpen, setCreatingOpen] = useState(false);

  // Creation is owned by useTaskCreate (CreateTaskPanel). Rendered in each
  // return branch below since this component has several.
  const createPanel = creatingOpen ? (
    <CreateTaskPanel
      seed={{ property_name: propertyName }}
      onClose={() => setCreatingOpen(false)}
      onCreated={(row) => {
        setCreatingOpen(false);
        setExpandedProject(row as unknown as Project);
        queryClient.invalidateQueries({ queryKey: ['tasks-for-bin'] });
        queryClient.invalidateQueries({ queryKey: qk.timeline });
        queryClient.invalidateQueries({ queryKey: qk.turnovers });
      }}
    />
  ) : null;

  if (expandedProject) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <TaskDetailPanel
            task={projectToTaskInput(expandedProject, users)}
            onClose={() => {
              setExpandedProject(null);
            }}
            onDeleted={() => setExpandedProject(null)}
            onOpenInPage={
              expandedProject
                ? () => {
                    const id = expandedProject.id;
                    setExpandedProject(null);
                    router.push(taskPath(id));
                  }
                : undefined
            }
          />
        </div>
        {createPanel}
      </div>
    );
  }

  if (propertyProjects.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <p>No projects for this property yet</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setCreatingOpen(true)}
        >
          Create Project
        </Button>
        {createPanel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {propertyProjects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          deptIconMap={deptIconMap}
          onClick={() => setExpandedProject(project)}
          onOpenInWindow={onOpenProjectInWindow}
        />
      ))}
      <Button
        variant="outline"
        className="w-full mt-2"
        onClick={() => setCreatingOpen(true)}
      >
        Add Project
      </Button>
      {createPanel}
    </div>
  );
}
