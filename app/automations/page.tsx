'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import { ChipButton } from '@/components/ui/panel/PanelForm';
import AutomationsView from '@/components/templates/AutomationsView';

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

export default function AutomationsPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [properties, setProperties] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'slack') {
      router.replace('/automations/new-engine');
    }
  }, [router]);

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
      <div className="panel-form flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--task-surface-0)' }}>
        {/* Tab bar — a real segmented control; the active tab is inert because
            you are already on it. */}
        <div
          className="flex shrink-0 items-center gap-1.5 border-b px-[18px] py-3"
          style={{ borderColor: 'var(--task-line-soft)' }}
        >
          <ChipButton set aria-current="page">
            Task Automations
          </ChipButton>
          <ChipButton set={false} onClick={() => router.push('/automations/new-engine')}>
            Slack Automations
          </ChipButton>
        </div>

        {/* Content — the view owns its own padding and scrolling. */}
        <div className="flex-1 overflow-hidden">
          <AutomationsView templates={templates} properties={properties} />
        </div>
      </div>
    </DesktopSidebarShell>
  );
}
