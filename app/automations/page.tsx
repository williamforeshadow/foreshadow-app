'use client';

import { useState, useEffect } from 'react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
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

interface PropertyListItem {
  name: string;
}

type AutomationTab = 'tasks' | 'slack';

export default function AutomationsPage() {
  const [activeTab, setActiveTab] = useState<AutomationTab>('tasks');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [properties, setProperties] = useState<string[]>([]);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await fetch('/api/templates');
        const data = await res.json();
        if (data.templates) setTemplates(data.templates);
      } catch (err) {
        console.error('Error fetching templates:', err);
      }
    };

    const fetchProperties = async () => {
      try {
        const res = await fetch('/api/properties');
        const data = await res.json() as { properties?: PropertyListItem[] };
        if (data.properties) {
          setProperties(data.properties.map((p) => p.name));
        }
      } catch (err) {
        console.error('Error fetching properties:', err);
      }
    };

    fetchTemplates();
    fetchProperties();
  }, []);

  return (
    <DesktopSidebarShell>
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
    </DesktopSidebarShell>
  );
}
