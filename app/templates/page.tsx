'use client';

import { useState, useEffect } from 'react';
import TemplatesList, { type TemplateListItem } from '@/components/templates/TemplatesList';
import { WindowHeader } from '@/components/ui/window-header';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/templates');
        const data = await res.json();
        if (data.templates) {
          setTemplates(data.templates);
        }
      } catch (err) {
        console.error('Error fetching templates:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  return (
    <>
      <WindowHeader title="Templates" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TemplatesList templates={templates} loading={loading} />
      </div>
    </>
  );
}
