'use client';

import { useState, useEffect, use } from 'react';
import TemplateEditor from '@/components/templates/TemplateEditor';

interface FieldDefinition {
  id: string;
  type: 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';
  label: string;
  required: boolean;
  options?: {
    maxPhotos?: number;
    maxSizeMB?: number;
  };
}

interface Template {
  id: string;
  name: string;
  type: 'cleaning' | 'maintenance';
  description: string | null;
  fields: FieldDefinition[];
}

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const res = await fetch(`/api/templates/${id}`);
        if (!res.ok) throw new Error('Template not found');
        const data = await res.json();
        setTemplate(data.template);
      } catch (err) {
        console.error('Error fetching template:', err);
        setError('Failed to load template');
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-500">Loading template...</p>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-red-500">{error || 'Template not found'}</p>
      </div>
    );
  }

  return (
    <TemplateEditor
      templateId={template.id}
      initialName={template.name}
      initialType={template.type}
      initialDescription={template.description || ''}
      initialFields={template.fields}
    />
  );
}
