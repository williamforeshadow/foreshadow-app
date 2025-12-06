'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Template {
  id: string;
  name: string;
  type: 'cleaning' | 'maintenance';
  description: string | null;
  fields: FieldDefinition[];
  created_at: string;
  updated_at: string;
}

type FieldType = 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';

interface FieldDefinition {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: {
    maxPhotos?: number;
    maxSizeMB?: number;
  };
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'rating', label: 'Rating (1-5)' },
  { value: 'yes-no', label: 'Yes/No' },
  { value: 'text', label: 'Text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'photo', label: 'Photo (Single)' },
  { value: 'photos', label: 'Photos (Multiple)' },
  { value: 'separator', label: 'Section Separator' },
];

interface PropertyAssignment {
  id?: string;
  property_name: string;
  template_id: string | null;
  enabled?: boolean;
}

export default function TemplatesPage() {
  const [activeView, setActiveView] = useState<'templates' | 'assignments'>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  
  // Property assignments state
  const [properties, setProperties] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<PropertyAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState<string | null>(null);
  const [configuringTemplate, setConfiguringTemplate] = useState<Template | null>(null);
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  
  // Simple form state for template editor
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'cleaning' | 'maintenance'>('cleaning');
  const [formDescription, setFormDescription] = useState('');
  const [formErrors, setFormErrors] = useState<{ name?: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (activeView === 'assignments') {
      fetchProperties();
      fetchAssignments();
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

  const fetchAssignments = async () => {
    setLoadingAssignments(true);
    try {
      const res = await fetch('/api/property-templates');
      const data = await res.json();
      if (data.assignments) {
        setAssignments(data.assignments);
      }
    } catch (err) {
      console.error('Error fetching assignments:', err);
    } finally {
      setLoadingAssignments(false);
    }
  };

  const saveAssignment = async (propertyName: string, templateId: string | null) => {
    setSavingAssignment(propertyName);
    try {
      const res = await fetch('/api/property-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: propertyName,
          template_id: templateId
        })
      });

      if (!res.ok) throw new Error('Failed to save assignment');
      
      // Refresh assignments
      await fetchAssignments();
    } catch (err) {
      console.error('Error saving assignment:', err);
      alert('Failed to save template assignment');
    } finally {
      setSavingAssignment(null);
    }
  };

  const getAssignedTemplate = (propertyName: string): string | null => {
    const assignment = assignments.find(a => a.property_name === propertyName);
    return assignment?.template_id || null;
  };

  const getAssignedProperties = (templateId: string): string[] => {
    return assignments
      .filter(a => a.template_id === templateId && a.enabled)
      .map(a => a.property_name);
  };

  const openConfigureDialog = (template: Template) => {
    setConfiguringTemplate(template);
    const assigned = getAssignedProperties(template.id);
    setSelectedProperties(assigned);
  };

  const saveTemplateAssignments = async () => {
    if (!configuringTemplate) return;

    setSavingAssignment(configuringTemplate.id);
    try {
      const res = await fetch('/api/property-templates/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: configuringTemplate.id,
          property_names: selectedProperties
        })
      });

      if (!res.ok) throw new Error('Failed to save assignments');
      
      await fetchAssignments();
      setConfiguringTemplate(null);
    } catch (err) {
      console.error('Error saving assignments:', err);
      alert('Failed to save property assignments');
    } finally {
      setSavingAssignment(null);
    }
  };

  const openCreateDialog = () => {
    setEditingTemplate(null);
    setFormName('');
    setFormType('cleaning');
    setFormDescription('');
    setFormErrors({});
    setFields([]);
    setShowCreateDialog(true);
  };

  const openEditDialog = (template: Template) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormType(template.type);
    setFormDescription(template.description || '');
    setFormErrors({});
    setFields(template.fields);
    setShowCreateDialog(true);
  };

  const addField = (type: FieldType) => {
    const defaultLabels: Record<FieldType, string> = {
      'rating': 'Rating',
      'yes-no': 'Question',
      'text': 'Notes',
      'checkbox': 'Completed',
      'photo': 'Photo',
      'photos': 'Photos',
      'separator': 'Section Title',
    };
    
    const newField: FieldDefinition = {
      id: `field_${Date.now()}`,
      type,
      label: defaultLabels[type],
      required: type !== 'separator' ? false : false
    };
    setFields([...fields, newField]);
  };

  const updateField = (index: number, updates: Partial<FieldDefinition>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFields(newFields);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const moveFieldUp = (index: number) => {
    if (index === 0) return;
    const newFields = [...fields];
    [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
    setFields(newFields);
  };

  const moveFieldDown = (index: number) => {
    if (index === fields.length - 1) return;
    const newFields = [...fields];
    [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
    setFields(newFields);
  };

  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate
    const errors: { name?: string } = {};
    if (!formName.trim()) {
      errors.name = 'Template name is required';
    }
    
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    
    setIsSaving(true);
    try {
      const payload = {
        name: formName,
        type: formType,
        description: formDescription || null,
        fields
      };

      if (editingTemplate) {
        // Update existing template
        const res = await fetch(`/api/templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update template');
      } else {
        // Create new template
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to create template');
      }

      setShowCreateDialog(false);
      fetchTemplates();
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete template');
      fetchTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
      alert('Failed to delete template');
    }
  };

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
                Cleaning Templates
              </h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                {activeView === 'templates' 
                  ? 'Create and manage cleaning form templates'
                  : 'Assign templates to properties'}
              </p>
            </div>
            {activeView === 'templates' && (
              <Button onClick={openCreateDialog}>
                Create New Template
              </Button>
            )}
          </div>
          
          {/* View Tabs */}
          <div className="flex gap-2">
            <Button
              onClick={() => setActiveView('templates')}
              variant={activeView === 'templates' ? 'default' : 'outline'}
              size="sm"
            >
              Templates
            </Button>
            <Button
              onClick={() => setActiveView('assignments')}
              variant={activeView === 'assignments' ? 'default' : 'outline'}
              size="sm"
            >
              Property Assignments
            </Button>
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
                    No templates yet. Create your first cleaning template!
                  </p>
                  <Button onClick={openCreateDialog}>
                    Create Template
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templates.map((template) => (
                <Card key={template.id}>
                  <CardHeader>
                    <CardTitle>{template.name}</CardTitle>
                    {template.description && (
                      <CardDescription>{template.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
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
                      <div className="flex gap-2">
                        <Button
                          onClick={() => openEditDialog(template)}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                        >
                          Edit
                        </Button>
                        <Button
                          onClick={() => deleteTemplate(template.id)}
                          variant="outline"
                          size="sm"
                          className="flex-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
              )}
            </>
          ) : (
            // Template Assignments View (Template-centric)
            <>
              {loading || loadingAssignments ? (
                <div className="text-center py-12 text-neutral-500">
                  Loading template assignments...
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-neutral-500 dark:text-neutral-400">
                    No templates found. Create a template first to assign it to properties.
                  </p>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-4">
                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      Configure which properties should automatically get tasks from each template. When a reservation is created for an assigned property, tasks will be auto-generated.
                    </p>
                  </div>

                  {templates.map((template) => {
                    const assignedProps = getAssignedProperties(template.id);
                    const isSaving = savingAssignment === template.id;
                    
                    return (
                      <Card key={template.id}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <CardTitle className="flex items-center gap-2">
                                {template.name}
                                <Badge 
                                  variant={template.type === 'maintenance' ? 'default' : 'secondary'}
                                  className={template.type === 'maintenance' 
                                    ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                                    : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-blue-300'
                                  }
                                >
                                  {template.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                </Badge>
                              </CardTitle>
                              {template.description && (
                                <CardDescription>{template.description}</CardDescription>
                              )}
                            </div>
                            <Button
                              onClick={() => openConfigureDialog(template)}
                              disabled={isSaving}
                              size="sm"
                            >
                              {isSaving ? 'Saving...' : 'Configure Properties'}
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-neutral-600 dark:text-neutral-400">
                              Assigned to:
                            </span>
                            {assignedProps.length === 0 ? (
                              <Badge variant="outline" className="text-neutral-500">
                                No properties
                              </Badge>
                            ) : assignedProps.length === properties.length ? (
                              <Badge variant="default">
                                All properties ({assignedProps.length})
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                {assignedProps.length} {assignedProps.length === 1 ? 'property' : 'properties'}
                              </Badge>
                            )}
                          </div>
                          {assignedProps.length > 0 && assignedProps.length < 10 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {assignedProps.map(prop => (
                                <Badge key={prop} variant="outline" className="text-xs">
                                  {prop}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create/Edit Template Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create New Template'}
            </DialogTitle>
            <DialogDescription>
              Configure the template details and form fields below.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveTemplate} className="px-2">
            <FieldSet>
              <FieldGroup>
                {/* Template Name */}
                <Field>
                  <FieldLabel>Template Name</FieldLabel>
                  <FieldContent>
                    <Input 
                      placeholder="e.g., Standard Clean, Deep Clean" 
                      value={formName}
                      onChange={(e) => {
                        setFormName(e.target.value);
                        if (formErrors.name) setFormErrors({});
                      }}
                      disabled={isSaving}
                      required
                    />
                    {formErrors.name && <FieldError>{formErrors.name}</FieldError>}
                  </FieldContent>
                </Field>

                {/* Template Type */}
                <Field>
                  <FieldLabel>Template Type</FieldLabel>
                  <FieldContent>
                    <Select 
                      onValueChange={(value) => setFormType(value as 'cleaning' | 'maintenance')} 
                      value={formType}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cleaning">Cleaning</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Choose whether this is a cleaning or maintenance template</FieldDescription>
                  </FieldContent>
                </Field>

                {/* Template Description */}
                <Field>
                  <FieldLabel>Description (Optional)</FieldLabel>
                  <FieldContent>
                    <Textarea 
                      placeholder="Brief description of this template"
                      rows={2}
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      disabled={isSaving}
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>

              <FieldSeparator>Form Fields</FieldSeparator>

              {/* Form Fields Section */}
              <div>
                <div className="flex items-center justify-end mb-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" type="button" disabled={isSaving}>
                        + Add Field
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {FIELD_TYPE_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => addField(option.value)}
                        >
                          {option.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {fields.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg">
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      No fields yet. Click "Add Field" to get started.
                    </p>
                  </div>
                ) : (
                  <FieldGroup>
                    {fields.map((field, index) => (
                      <div
                        key={field.id}
                        className={`border rounded-lg p-6 ${
                          field.type === 'separator'
                            ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20'
                            : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50'
                        }`}
                      >
                        {/* Field Type Badge & Required */}
                        <div className="flex items-center justify-between mb-4">
                          <Badge variant="secondary" className="text-xs px-3 py-1">
                            {FIELD_TYPE_OPTIONS.find(o => o.value === field.type)?.label || field.type}
                          </Badge>
                          {field.type !== 'separator' && (
                            <label className="flex items-center gap-2 cursor-pointer pr-1">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(index, { required: e.target.checked })}
                                className="w-4 h-4 rounded border-neutral-300"
                                disabled={isSaving}
                              />
                              <span className="text-xs text-neutral-600 dark:text-neutral-400">Required</span>
                            </label>
                          )}
                        </div>

                        {/* Field Label Input */}
                        <Input
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                          placeholder={field.type === 'separator' ? 'Enter section title' : 'Enter field label'}
                          disabled={isSaving}
                        />

                        {/* Action Buttons */}
                        <div className="flex gap-1 mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-700">
                          <button
                            onClick={() => moveFieldUp(index)}
                            disabled={index === 0 || isSaving}
                            type="button"
                            className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveFieldDown(index)}
                            disabled={index === fields.length - 1 || isSaving}
                            type="button"
                            className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            ↓
                          </button>
                          <Button
                            onClick={() => removeField(index)}
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto"
                            disabled={isSaving}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </FieldGroup>
                )}
              </div>
            </FieldSet>

            <div className="flex justify-end gap-3 mt-8">
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : editingTemplate ? 'Update Template' : 'Create Template'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Configure Template Properties Dialog */}
      <Dialog open={!!configuringTemplate} onOpenChange={(open) => !open && setConfiguringTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure Properties for "{configuringTemplate?.name}"</DialogTitle>
            <DialogDescription>
              Select which properties should automatically get tasks from this template when reservations are created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {properties.length === 0 ? (
              <div className="text-center py-8 text-neutral-500">
                No properties found. Properties will appear here once you have reservations.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
                  <span className="text-sm font-medium">
                    {selectedProperties.length === properties.length 
                      ? 'All properties selected' 
                      : `${selectedProperties.length} of ${properties.length} selected`}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedProperties(properties)}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedProperties([])}
                    >
                      Clear All
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[400px] overflow-y-auto p-2">
                  {properties.map((property) => {
                    const isSelected = selectedProperties.includes(property);
                    return (
                      <label
                        key={property}
                        className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedProperties([...selectedProperties, property]);
                            } else {
                              setSelectedProperties(selectedProperties.filter(p => p !== property));
                            }
                          }}
                          className="rounded border-neutral-300"
                        />
                        <span className="text-sm font-medium">{property}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfiguringTemplate(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveTemplateAssignments}
              disabled={savingAssignment === configuringTemplate?.id}
            >
              {savingAssignment === configuringTemplate?.id ? 'Saving...' : 'Save Assignments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

