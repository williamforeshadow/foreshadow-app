'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import AutomationsView from '@/components/templates/AutomationsView';

interface Template {
  id: string;
  name: string;
  type: string;
  department_id: string | null;
  department_name: string | null;
  description: string | null;
  fields: { id: string }[];
  created_at: string;
  updated_at: string;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<'templates' | 'automations'>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Properties state (for automations view)
  const [properties, setProperties] = useState<string[]>([]);

  useEffect(() => {
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (activeView === 'automations') {
      fetchProperties();
    }
  }, [activeView]);

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

  const fetchProperties = async () => {
    try {
      const res = await fetch('/api/properties');
      const data = await res.json();
      if (data.properties) {
        // API now returns {id, name} objects; extract names for automations view
        setProperties(data.properties.map((p: any) => p.name));
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Top bar — sidebar toggle + page title in a single row that spans
          the full viewport above the sidebar. The view tabs + create
          button live in a sub-header inside the content column below. */}
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
        <SidebarToggleButton />
        <h1 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
          Templates &amp; Automations
        </h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* View Tabs + Create Button */}
          <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 py-4 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                onClick={() => setActiveView('templates')}
                variant={activeView === 'templates' ? 'default' : 'outline'}
                size="sm"
              >
                Templates
              </Button>
              <Button
                onClick={() => setActiveView('automations')}
                variant={activeView === 'automations' ? 'default' : 'outline'}
                size="sm"
              >
                Automations
              </Button>
            </div>
            {activeView === 'templates' && (
              <Button onClick={() => router.push('/templates/new')}>
                Create New Template
              </Button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {activeView === 'templates' ? (
              // Templates View
              <>
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
                              {template.department_name || template.type}
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
              </>
            ) : (
              // Automations View
              <AutomationsView
                templates={templates}
                properties={properties}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
