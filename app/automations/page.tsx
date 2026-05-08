'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { Button } from '@/components/ui/button';
import AutomationsView from '@/components/templates/AutomationsView';
import SlackAutomationsView from '@/components/automations/SlackAutomationsView';

interface Template {
  id: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  description: string | null;
  fields: { id: string }[];
  created_at: string;
  updated_at: string;
}

type AutomationTab = 'tasks' | 'slack';

export default function AutomationsPage() {
  const [activeTab, setActiveTab] = useState<AutomationTab>('tasks');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
    fetchProperties();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.templates) setTemplates(data.templates);
    } catch (err) {
      console.error('Error fetching templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProperties = async () => {
    try {
      const res = await fetch('/api/properties');
      const data = await res.json();
      if (data.properties) {
        setProperties(data.properties.map((p: any) => p.name));
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-card">
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-card border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
        <SidebarToggleButton />
        <h1 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
          Automations
        </h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 py-4 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                onClick={() => setActiveTab('tasks')}
                variant={activeTab === 'tasks' ? 'default' : 'outline'}
                size="sm"
              >
                Task Automations
              </Button>
              <Button
                onClick={() => setActiveTab('slack')}
                variant={activeTab === 'slack' ? 'default' : 'outline'}
                size="sm"
              >
                Slack Automations
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {activeTab === 'tasks' ? (
              <AutomationsView templates={templates} properties={properties} />
            ) : (
              <SlackAutomationsView />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
