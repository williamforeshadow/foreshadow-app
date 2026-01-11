'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import { useProjects } from '@/lib/useProjects';
import TimelineWindow from '@/components/windows/TimelineWindow';
import FloatingWindow from '@/components/FloatingWindow';
import TurnoversWindow from '@/components/windows/TurnoversWindow';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import TasksWindow from '@/components/windows/TasksWindow';
import { AiChat } from '@/components/AiChat';

export default function DesktopApp() {
  // Hooks
  const { users } = useUsers();
  const { user: currentUser } = useAuth();

  // Shared project state - called once, shared by all windows
  const projectsHook = useProjects({ currentUser });

  // Window visibility state
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);
  const [showProjectsWindow, setShowProjectsWindow] = useState(false);
  const [showTasksWindow, setShowTasksWindow] = useState(false);

  // Window stacking order
  const [windowOrder, setWindowOrder] = useState<Array<'cards' | 'timeline' | 'projects' | 'tasks'>>(['cards', 'timeline', 'projects', 'tasks']);

  const bringToFront = (window: 'cards' | 'timeline' | 'projects' | 'tasks') => {
    setWindowOrder(prev => [...prev.filter(w => w !== window), window]);
  };

  const getZIndex = (window: 'cards' | 'timeline' | 'projects' | 'tasks') => {
    return 10 + windowOrder.indexOf(window);
  };

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
              <Button
                onClick={() => {
                  if (showTasksWindow) {
                    setShowTasksWindow(false);
                  } else {
                    setShowTasksWindow(true);
                    bringToFront('tasks');
                  }
                }}
                variant="secondary"
                size="sm"
                className="px-4 py-2"
              >
                Tasks
              </Button>
            </div>
          </div>
        </div>

        {/* Floating Windows Container */}
        <div className="flex-1 relative overflow-hidden bg-background">
          {/* Turnovers Window - Always mounted, visibility controlled by CSS */}
          <div className={`absolute inset-0 ${showCardsWindow ? '' : 'hidden'}`}>
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
                projectsHook={projectsHook}
                onOpenProjectInWindow={() => {
                  setShowProjectsWindow(true);
                  bringToFront('projects');
                }}
              />
            </FloatingWindow>
          </div>

          {/* Timeline Window - Always mounted, visibility controlled by CSS */}
          <div className={`absolute inset-0 ${showTimelineWindow ? '' : 'hidden'}`}>
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
          </div>

          {/* Projects Window - Always mounted, visibility controlled by CSS */}
          <div className={`absolute inset-0 ${showProjectsWindow ? '' : 'hidden'}`}>
            <FloatingWindow
              id="projects"
              title="Property Projects"
              defaultPosition={{ x: 300, y: 100 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('projects')}
              onClose={() => setShowProjectsWindow(false)}
              onFocus={() => bringToFront('projects')}
            >
              <ProjectsWindow users={users} currentUser={currentUser} projectsHook={projectsHook} />
            </FloatingWindow>
          </div>

          {/* Tasks Window - Always mounted, visibility controlled by CSS */}
          <div className={`absolute inset-0 ${showTasksWindow ? '' : 'hidden'}`}>
            <FloatingWindow
              id="tasks"
              title="Tasks"
              defaultPosition={{ x: 200, y: 120 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('tasks')}
              onClose={() => setShowTasksWindow(false)}
              onFocus={() => bringToFront('tasks')}
            >
              <TasksWindow />
            </FloatingWindow>
          </div>

          {/* AI Chat */}
          <AiChat />
        </div>
      </div>
    </div>
  );
}
