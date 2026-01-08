'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import TimelineWindow from '@/components/windows/TimelineWindow';
import FloatingWindow from '@/components/FloatingWindow';
import TurnoversWindow from '@/components/windows/TurnoversWindow';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import { AiChat } from '@/components/AiChat';

export default function DesktopApp() {
  // Hooks
  const { users } = useUsers();
  const { user: currentUser } = useAuth();

  // Window visibility state
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);
  const [showProjectsWindow, setShowProjectsWindow] = useState(false);

  // Window stacking order
  const [windowOrder, setWindowOrder] = useState<Array<'cards' | 'timeline' | 'projects'>>(['cards', 'timeline', 'projects']);

  const bringToFront = (window: 'cards' | 'timeline' | 'projects') => {
    setWindowOrder(prev => [...prev.filter(w => w !== window), window]);
  };

  const getZIndex = (window: 'cards' | 'timeline' | 'projects') => {
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
            </div>
          </div>
        </div>

        {/* Floating Windows Container */}
        <div className="flex-1 relative overflow-hidden bg-background">
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
