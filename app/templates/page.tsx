'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import AutomationsView from '@/components/templates/AutomationsView';

interface Template {
  id: string;
  name: string;
  type: 'cleaning' | 'maintenance';
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
        setProperties(data.properties);
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  };

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Templates & Automations
          </h1>
          
          {/* View Tabs + Create Button */}
          <div className="flex items-center justify-between mt-4">
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
                            variant={template.type === 'maintenance' ? 'default' : 'secondary'}
                            className={template.type === 'maintenance' 
                              ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                              : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-blue-300'
                            }
                          >
                            {template.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
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
  );
}
