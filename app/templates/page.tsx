'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

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

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
        <SidebarToggleButton />
        <h1 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
          Templates
        </h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 py-4 flex items-center justify-end">
            <Button onClick={() => router.push('/templates/new')}>
              Create New Template
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="text-center py-12 text-neutral-500">
                Loading templates...
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                  No templates yet. Create your first task template!
                </p>
                <Button onClick={() => router.push('/templates/new')}>
                  Create Template
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {templates.map((template) => (
                  <Card
                    key={template.id}
                    className="cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
                    onClick={() => router.push(`/templates/${template.id}`)}
                  >
                    <CardHeader>
                      <CardTitle className="truncate">{template.name}</CardTitle>
                      {template.description && (
                        <CardDescription className="line-clamp-1">{template.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-600"
                        >
                          {template.department_name || 'Uncategorized'}
                        </Badge>
                        <Badge variant="secondary">
                          {template.fields.length} field{template.fields.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
