'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type AutomationConfig,
  type AutomationPreset,
  type PropertyTemplateAssignment,
  type User,
  createDefaultAutomationConfig,
} from '@/lib/types';


interface Template {
  id: string;
  name: string;
  type: 'cleaning' | 'maintenance';
  description: string | null;
}

interface AutomationsViewProps {
  templates: Template[];
  properties: string[];
}

export default function AutomationsView({ templates, properties }: AutomationsViewProps) {
  const router = useRouter();

  // Data state
  const [assignments, setAssignments] = useState<PropertyTemplateAssignment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [presets, setPresets] = useState<AutomationPreset[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Add new automation state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [newAutomationConfig, setNewAutomationConfig] = useState<AutomationConfig | null>(null);

  // Bulk edit state
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [showBulkAddDialog, setShowBulkAddDialog] = useState(false);

  // Fetch data on mount
  useEffect(() => {
    fetchData();
  }, []);

  // Auto-select first property when data loads
  useEffect(() => {
    if (!selectedProperty && properties.length > 0) {
      setSelectedProperty(properties[0]);
    }
  }, [properties, selectedProperty]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [assignmentsRes, usersRes, presetsRes] = await Promise.all([
        fetch('/api/property-templates'),
        fetch('/api/users'),
        fetch('/api/automation-presets'),
      ]);

      const [assignmentsData, usersData, presetsData] = await Promise.all([
        assignmentsRes.json(),
        usersRes.json(),
        presetsRes.json(),
      ]);

      if (assignmentsData.assignments) setAssignments(assignmentsData.assignments);
      if (usersData.data) setUsers(usersData.data);
      if (presetsData.presets) setPresets(presetsData.presets);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Group assignments by property
  const assignmentsByProperty = useMemo(() => {
    const grouped: Record<string, PropertyTemplateAssignment[]> = {};
    
    // Initialize all properties with empty arrays
    properties.forEach(prop => {
      grouped[prop] = [];
    });
    
    // Add assignments to their properties
    assignments.forEach(assignment => {
      if (grouped[assignment.property_name]) {
        grouped[assignment.property_name].push(assignment);
      }
    });
    
    return grouped;
  }, [assignments, properties]);

  // Get automation count for a property
  const getAutomationCount = (propertyName: string) => {
    return assignmentsByProperty[propertyName]?.filter(a => a.automation_config?.enabled).length || 0;
  };

  // Get template name by ID
  const getTemplate = (templateId: string) => {
    return templates.find(t => t.id === templateId);
  };

  // Get assignments for selected property
  const selectedPropertyAssignments = selectedProperty ? assignmentsByProperty[selectedProperty] || [] : [];

  // Filter properties by search query
  const filteredProperties = useMemo(() => {
    if (!searchQuery.trim()) return properties;
    const q = searchQuery.toLowerCase();
    return properties.filter(p => p.toLowerCase().includes(q));
  }, [properties, searchQuery]);

  // Get templates not yet assigned to selected property
  const availableTemplates = useMemo(() => {
    if (!selectedProperty) return templates;
    const assignedTemplateIds = selectedPropertyAssignments.map(a => a.template_id);
    return templates.filter(t => !assignedTemplateIds.includes(t.id));
  }, [templates, selectedProperty, selectedPropertyAssignments]);

  // Open add dialog
  const openAddDialog = () => {
    setSelectedTemplateId('');
    setShowAddDialog(true);
  };

  // Save new automation (adds template with auto-generation off by default)
  const saveNewAutomation = async () => {
    if (!selectedProperty || !selectedTemplateId) return;

    setSaving(true);
    try {
      const res = await fetch('/api/property-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: selectedProperty,
          template_id: selectedTemplateId,
          enabled: true,
          automation_config: createDefaultAutomationConfig(),
        }),
      });

      if (!res.ok) throw new Error('Failed to create automation');

      await fetchData();
      setShowAddDialog(false);
      setSelectedTemplateId('');
    } catch (err) {
      console.error('Error creating automation:', err);
      alert('Failed to create automation');
    } finally {
      setSaving(false);
    }
  };

  // Open bulk add dialog
  const openBulkAddDialog = () => {
    setSelectedTemplateId('');
    const defaultConfig = createDefaultAutomationConfig();
    defaultConfig.enabled = false;
    setNewAutomationConfig(defaultConfig);
    setShowBulkAddDialog(true);
  };

  // Navigate to bulk configure page
  const saveBulkAutomation = () => {
    if (selectedProperties.size === 0 || !selectedTemplateId) return;

    const propertiesParam = encodeURIComponent(Array.from(selectedProperties).join(','));
    setShowBulkAddDialog(false);
    router.push(`/templates/automation/bulk-configure?properties=${propertiesParam}&template=${encodeURIComponent(selectedTemplateId)}`);
  };

  // Toggle property selection for bulk edit
  const togglePropertySelection = (property: string) => {
    const newSelected = new Set(selectedProperties);
    if (newSelected.has(property)) {
      newSelected.delete(property);
    } else {
      newSelected.add(property);
    }
    setSelectedProperties(newSelected);
  };

  // Delete automation
  const deleteAutomation = async (assignment: PropertyTemplateAssignment) => {
    if (!confirm('Remove this template automation from the property?')) return;

    try {
      const res = await fetch(`/api/property-templates?property_name=${encodeURIComponent(assignment.property_name)}&template_id=${assignment.template_id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete');
      await fetchData();
    } catch (err) {
      console.error('Error deleting automation:', err);
      alert('Failed to delete automation');
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-neutral-500">
        Loading automations...
      </div>
    );
  }

  return (
    <div className="flex h-full -m-6">
      {/* Left Panel - Properties List */}
      <div className="w-80 border-r border-neutral-200 dark:border-neutral-700 overflow-y-auto">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm text-neutral-700 dark:text-neutral-300">Properties</h3>
              <p className="text-xs text-neutral-500 mt-1">
                {bulkEditMode && selectedProperties.size > 0 
                  ? `${selectedProperties.size} selected`
                  : `${filteredProperties.length} properties`
                }
              </p>
            </div>
            <Button 
              size="sm" 
              variant={bulkEditMode ? "default" : "outline"}
              onClick={() => {
                setBulkEditMode(!bulkEditMode);
                setSelectedProperties(new Set());
              }}
            >
              {bulkEditMode ? 'Done' : 'Bulk Edit'}
            </Button>
          </div>
          <Input
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mt-3 h-8 text-sm"
          />
        </div>
        
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {filteredProperties.map((property) => {
            const automationCount = getAutomationCount(property);
            const totalAssignments = assignmentsByProperty[property]?.length || 0;
            const isSelected = selectedProperty === property;
            const isBulkSelected = selectedProperties.has(property);
            
            return (
              <div
                key={property}
                onClick={() => bulkEditMode ? togglePropertySelection(property) : setSelectedProperty(property)}
                className={`w-full text-left p-4 transition-colors cursor-pointer flex items-center gap-3 ${
                  bulkEditMode
                    ? isBulkSelected
                      ? 'bg-neutral-100 dark:bg-neutral-800 border-l-4 border-neutral-900 dark:border-white'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 border-l-4 border-transparent'
                    : isSelected 
                      ? 'bg-neutral-100 dark:bg-neutral-800 border-l-4 border-neutral-900 dark:border-white' 
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 border-l-4 border-transparent'
                }`}
              >
                {bulkEditMode && (
                  <input
                    type="checkbox"
                    checked={isBulkSelected}
                    onChange={() => togglePropertySelection(property)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-neutral-300"
                  />
                )}
                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                  <div className="font-medium text-sm truncate">{property}</div>
                  {automationCount > 0 ? (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {automationCount}
                    </Badge>
                  ) : totalAssignments > 0 ? (
                    <Badge variant="outline" className="text-xs text-neutral-500 shrink-0">
                      {totalAssignments}
                    </Badge>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Panel - Property Detail or Bulk Selection */}
      <div className="flex-1 overflow-y-auto">
        {bulkEditMode ? (
          // BULK MODE VIEW
          <div className="p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold">
                  {selectedProperties.size > 0 
                    ? `Add Template Automation for ${selectedProperties.size} Selected Properties`
                    : 'Select Properties'}
                </h2>
                <p className="text-sm text-neutral-500 mt-1">
                  {selectedProperties.size > 0 
                    ? Array.from(selectedProperties).slice(0, 3).join(', ') + (selectedProperties.size > 3 ? `, and ${selectedProperties.size - 3} more` : '')
                    : 'Check properties on the left to apply bulk automation'}
                </p>
              </div>
              {selectedProperties.size > 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelectedProperties(new Set())}>
                    Clear Selection
                  </Button>
                  <Button variant="outline" onClick={() => setSelectedProperties(new Set(properties))}>
                    Select All
                  </Button>
                </div>
              )}
            </div>
            
            {selectedProperties.size === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-lg">
                <p className="text-neutral-500">No properties selected.</p>
                <p className="text-sm text-neutral-400 mt-1">Use the checkboxes on the left to select properties for bulk automation.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Selected properties summary */}
                <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    Selected Properties ({selectedProperties.size}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(selectedProperties).map(prop => (
                      <Badge 
                        key={prop} 
                        variant="secondary"
                      >
                        {prop}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Button onClick={openBulkAddDialog} className="w-full" size="lg">
                  Add or Edit Template Automation to {selectedProperties.size} Properties
                </Button>
              </div>
            )}
          </div>
        ) : selectedProperty ? (
          // SINGLE PROPERTY VIEW
          <div className="px-6 pt-4">
            {/* Property Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">{selectedProperty}</h2>
              </div>
              <Button onClick={openAddDialog} disabled={availableTemplates.length === 0}>
                + Add Template
              </Button>
            </div>

            {/* Template Automations */}
            {selectedPropertyAssignments.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-lg">
                <p className="text-neutral-500">No templates configured for this property.</p>
                <p className="text-sm text-neutral-400 mt-1">Click &quot;Add Template&quot; to configure task automations.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {selectedPropertyAssignments.map((assignment) => {
                  const template = getTemplate(assignment.template_id);
                  const hasOverrides = !!(
                    assignment.field_overrides &&
                    (assignment.field_overrides.additional_fields?.length > 0 ||
                      assignment.field_overrides.removed_field_ids?.length > 0 ||
                      Object.keys(assignment.field_overrides.modified_fields ?? {}).length > 0)
                  );

                  return (
                    <Card
                      key={assignment.id}
                      className="cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
                      onClick={() =>
                        router.push(
                          `/templates/automation/configure?property=${encodeURIComponent(assignment.property_name)}&template=${encodeURIComponent(assignment.template_id)}`
                        )
                      }
                    >
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2 truncate">
                            {template?.name || 'Unknown Template'}
                            <Badge 
                              variant={template?.type === 'maintenance' ? 'default' : 'secondary'}
                              className={template?.type === 'maintenance' 
                                ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                                : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-blue-300'
                              }
                            >
                              {template?.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                            </Badge>
                            {hasOverrides && (
                              <Badge variant="outline" className="text-xs">
                                Customized
                              </Badge>
                            )}
                          </CardTitle>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(
                                  `/templates/automation/fields?property=${encodeURIComponent(assignment.property_name)}&template=${encodeURIComponent(assignment.template_id)}`
                                );
                              }}
                            >
                              Property Fields
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteAutomation(assignment);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-500">
            Select a property to view its automations
          </div>
        )}
      </div>

      {/* Add Template Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Template Automation</DialogTitle>
            <DialogDescription>
              Configure a new template automation for {selectedProperty}
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel>Select Template</FieldLabel>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                {availableTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <span className="flex items-center gap-2">
                      {template.name}
                      <Badge variant="outline" className="text-xs">
                        {template.type}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableTemplates.length === 0 && (
              <FieldDescription className="text-amber-600">
                All templates are already assigned to this property.
              </FieldDescription>
            )}
          </Field>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveNewAutomation} 
              disabled={saving || !selectedTemplateId}
            >
              {saving ? 'Saving...' : 'Add Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Add/Edit Template Dialog */}
      <Dialog open={showBulkAddDialog} onOpenChange={setShowBulkAddDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add or Edit Template Automation</DialogTitle>
            <DialogDescription>
              Configure automation for {selectedProperties.size} selected properties
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Selected properties summary */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Applying to {selectedProperties.size} properties:
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                {Array.from(selectedProperties).join(', ')}
              </p>
            </div>

            {/* Template Selection */}
            <Field>
              <FieldLabel>Select Template</FieldLabel>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      <span className="flex items-center gap-2">
                        {template.name}
                        <Badge variant="outline" className="text-xs">
                          {template.type}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                This template will be added to all selected properties with default settings
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setShowBulkAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveBulkAutomation} 
              disabled={!selectedTemplateId}
            >
              {`Configure for ${selectedProperties.size} Properties`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
