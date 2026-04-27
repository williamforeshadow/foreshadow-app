'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { useUsers } from '@/lib/useUsers';
import { useAuth } from '@/lib/authContext';
import TimelineWindow from '@/components/windows/TimelineWindow';
import TurnoversWindow from '@/components/windows/TurnoversWindow';
import ProjectsWindow from '@/components/windows/ProjectsWindow';
import TasksWindow from '@/components/windows/TasksWindow';
import MessagesWindow from '@/components/windows/MessagesWindow';
import { AiChat } from '@/components/AiChat';

type ViewType = 'turnovers' | 'timeline' | 'projects' | 'tasks' | 'messages';

export default function DesktopApp() {
  // Hooks
  const { users } = useUsers();
  const { user: currentUser } = useAuth();

  // Active view state - single state instead of multiple booleans
  const [activeView, setActiveView] = useState<ViewType>('turnovers');

  const viewLabels: Record<ViewType, string> = {
    turnovers: 'Turnovers',
    timeline: 'Timeline',
    projects: 'Bins',
    tasks: 'Tasks',
    messages: 'Messages'
  };

  return (
    <div className="flex h-screen bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      <Sidebar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fixed Header with Page Title and Navigation */}
        <div className="flex-shrink-0 px-6 py-3 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            {/* Page Title */}
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">
              {viewLabels[activeView]}
            </h1>
            
            {/* View Navigation */}
            <div className="flex items-center gap-1">
              {(['turnovers', 'timeline', 'projects', 'tasks', 'messages'] as ViewType[]).map((view) => (
                <Button
                  key={view}
                  onClick={() => setActiveView(view)}
                  variant={activeView === view ? 'default' : 'ghost'}
                  size="sm"
                  className={`px-4 py-2 ${
                    activeView === view 
                      ? '' 
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {viewLabels[view]}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Full Screen Content Area */}
        <div className="flex-1 relative overflow-hidden bg-background">
          {/* Render active view - all views stay mounted for state preservation */}
          <div className={`absolute inset-0 ${activeView === 'turnovers' ? '' : 'hidden'}`}>
            <TurnoversWindow
              users={users}
              currentUser={currentUser}
            />
          </div>

          <div className={`absolute inset-0 ${activeView === 'timeline' ? '' : 'hidden'}`}>
            <TimelineWindow
              users={users}
              currentUser={currentUser}
            />
          </div>

          <div className={`absolute inset-0 ${activeView === 'projects' ? '' : 'hidden'}`}>
            <ProjectsWindow users={users} currentUser={currentUser} />
          </div>

          <div className={`absolute inset-0 ${activeView === 'tasks' ? '' : 'hidden'}`}>
            <TasksWindow currentUser={currentUser} users={users} />
          </div>

          <div className={`absolute inset-0 ${activeView === 'messages' ? '' : 'hidden'}`}>
            <MessagesWindow currentUser={currentUser} users={users} />
          </div>

          {/* AI Chat */}
          <AiChat />
        </div>
      </div>
    </div>
  );
}
