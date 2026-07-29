'use client';

// Task automations list. Moved here from /automations when that route became
// the two-button hub; its configure / fields / bulk-configure subroutes were
// already under /automations/tasks.

import { useEffect, useState } from 'react';
import AutomationsBackLink from '@/components/automations/AutomationsBackLink';
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

export default function TaskAutomationsPage() {
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
    <>
      <div className="panel-form flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--task-surface-0)' }}>
        <AutomationsBackLink />

        <div className="flex-1 overflow-hidden">
          <AutomationsView templates={templates} properties={properties} />
        </div>
      </div>
    </>
  );
}
