'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
import AutomationConfigForm from './AutomationConfigForm';

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
  // Data state
  const [assignments, setAssignments] = useState<PropertyTemplateAssignment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [presets, setPresets] = useState<AutomationPreset[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<PropertyTemplateAssignment | null>(null);
  const [automationConfig, setAutomationConfig] = useState<AutomationConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [presetName, setPresetName] = useState('');
  
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

  // Get templates not yet assigned to selected property
  const availableTemplates = useMemo(() => {
    if (!selectedProperty) return templates;
    const assignedTemplateIds = selectedPropertyAssignments.map(a => a.template_id);
    return templates.filter(t => !assignedTemplateIds.includes(t.id));
  }, [templates, selectedProperty, selectedPropertyAssignments]);

  // Open edit dialog
  const openEditDialog = (assignment: PropertyTemplateAssignment) => {
    setEditingAssignment(assignment);
    const defaults = createDefaultAutomationConfig();
    const saved = assignment.automation_config;
    
    // Deep merge with defaults to ensure all nested fields exist
    const config: AutomationConfig = saved ? {
      enabled: saved.enabled ?? defaults.enabled,
      trigger_type: saved.trigger_type ?? defaults.trigger_type,
      schedule: {
        enabled: saved.schedule?.enabled ?? defaults.schedule.enabled,
        type: saved.schedule?.type ?? defaults.schedule.type,
        relative_to: saved.schedule?.relative_to ?? defaults.schedule.relative_to,
        days_offset: saved.schedule?.days_offset ?? defaults.schedule.days_offset,
        time: saved.schedule?.time ?? defaults.schedule.time,
      },
      same_day_override: {
        enabled: saved.same_day_override?.enabled ?? defaults.same_day_override.enabled,
        schedule: {
          type: saved.same_day_override?.schedule?.type ?? defaults.same_day_override.schedule.type,
          relative_to: saved.same_day_override?.schedule?.relative_to ?? defaults.same_day_override.schedule.relative_to,
          days_offset: saved.same_day_override?.schedule?.days_offset ?? defaults.same_day_override.schedule.days_offset,
          time: saved.same_day_override?.schedule?.time ?? defaults.same_day_override.schedule.time,
        },
      },
      auto_assign: {
        enabled: saved.auto_assign?.enabled ?? defaults.auto_assign.enabled,
        user_ids: saved.auto_assign?.user_ids ?? defaults.auto_assign.user_ids,
      },
      // Occupancy-specific fields
      occupancy_condition: {
        operator: saved.occupancy_condition?.operator ?? defaults.occupancy_condition!.operator,
        days: saved.occupancy_condition?.days ?? defaults.occupancy_condition!.days,
        days_end: saved.occupancy_condition?.days_end,
      },
      occupancy_schedule: {
        enabled: saved.occupancy_schedule?.enabled ?? defaults.occupancy_schedule!.enabled,
        day_of_occupancy: saved.occupancy_schedule?.day_of_occupancy ?? defaults.occupancy_schedule!.day_of_occupancy,
        time: saved.occupancy_schedule?.time ?? defaults.occupancy_schedule!.time,
        repeat: {
          enabled: saved.occupancy_schedule?.repeat?.enabled ?? defaults.occupancy_schedule!.repeat.enabled,
          interval_days: saved.occupancy_schedule?.repeat?.interval_days ?? defaults.occupancy_schedule!.repeat.interval_days,
        },
      },
      // Vacancy-specific fields
      vacancy_condition: {
        operator: saved.vacancy_condition?.operator ?? defaults.vacancy_condition!.operator,
        days: saved.vacancy_condition?.days ?? defaults.vacancy_condition!.days,
        days_end: saved.vacancy_condition?.days_end,
      },
      vacancy_schedule: {
        enabled: saved.vacancy_schedule?.enabled ?? defaults.vacancy_schedule!.enabled,
        day_of_vacancy: saved.vacancy_schedule?.day_of_vacancy ?? defaults.vacancy_schedule!.day_of_vacancy,
        time: saved.vacancy_schedule?.time ?? defaults.vacancy_schedule!.time,
        repeat: {
          enabled: saved.vacancy_schedule?.repeat?.enabled ?? defaults.vacancy_schedule!.repeat.enabled,
          interval_days: saved.vacancy_schedule?.repeat?.interval_days ?? defaults.vacancy_schedule!.repeat.interval_days,
        },
        max_days_ahead: saved.vacancy_schedule?.max_days_ahead ?? defaults.vacancy_schedule!.max_days_ahead,
      },
      // Recurring-specific fields
      recurring_schedule: {
        start_date: saved.recurring_schedule?.start_date ?? defaults.recurring_schedule!.start_date,
        time: saved.recurring_schedule?.time ?? defaults.recurring_schedule!.time,
        interval_value: saved.recurring_schedule?.interval_value ?? defaults.recurring_schedule!.interval_value,
        interval_unit: saved.recurring_schedule?.interval_unit ?? defaults.recurring_schedule!.interval_unit,
      },
      // Contingent tasks config
      contingent: {
        enabled: saved.contingent?.enabled ?? defaults.contingent!.enabled,
        auto_approve_enabled: saved.contingent?.auto_approve_enabled ?? defaults.contingent!.auto_approve_enabled,
        auto_approve_days: saved.contingent?.auto_approve_days ?? defaults.contingent!.auto_approve_days,
      },
      preset_id: saved.preset_id ?? null,
    } : defaults;
    
    setAutomationConfig(config);
  };

  // Open add dialog
  const openAddDialog = () => {
    setSelectedTemplateId('');
    const defaultConfig = createDefaultAutomationConfig();
    defaultConfig.enabled = true; // Enable by default when adding
    setNewAutomationConfig(defaultConfig);
    setShowAddDialog(true);
  };

  // Save existing automation config
  const saveAutomationConfig = async () => {
    if (!editingAssignment || !automationConfig) return;

    setSaving(true);
    try {
      const res = await fetch('/api/property-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: editingAssignment.property_name,
          template_id: editingAssignment.template_id,
          enabled: editingAssignment.enabled,
          automation_config: automationConfig,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        console.error('Save error details:', errData);
        throw new Error(errData.error || 'Failed to save automation config');
      }

      await fetchData();
      setEditingAssignment(null);
      setAutomationConfig(null);
    } catch (err) {
      console.error('Error saving automation config:', err);
      alert(err instanceof Error ? err.message : 'Failed to save automation configuration');
    } finally {
      setSaving(false);
    }
  };

  // Save new automation
  const saveNewAutomation = async () => {
    if (!selectedProperty || !selectedTemplateId || !newAutomationConfig) return;

    setSaving(true);
    try {
      const res = await fetch('/api/property-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: selectedProperty,
          template_id: selectedTemplateId,
          enabled: true,
          automation_config: newAutomationConfig,
        }),
      });

      if (!res.ok) throw new Error('Failed to create automation');

      await fetchData();
      setShowAddDialog(false);
      setSelectedTemplateId('');
      setNewAutomationConfig(null);
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
    defaultConfig.enabled = true;
    setNewAutomationConfig(defaultConfig);
    setShowBulkAddDialog(true);
  };

  // Save bulk automation to multiple properties
  const saveBulkAutomation = async () => {
    if (selectedProperties.size === 0 || !selectedTemplateId || !newAutomationConfig) return;

    setSaving(true);
    try {
      const promises = Array.from(selectedProperties).map(propertyName =>
        fetch('/api/property-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            property_name: propertyName,
            template_id: selectedTemplateId,
            enabled: true,
            automation_config: newAutomationConfig,
          }),
        })
      );

      const results = await Promise.all(promises);
      const failed = results.filter(r => !r.ok).length;

      if (failed > 0) {
        alert(`Applied to ${selectedProperties.size - failed} properties. ${failed} failed.`);
      }

      await fetchData();
      setShowBulkAddDialog(false);
      setSelectedProperties(new Set());
      setBulkEditMode(false);
      setSelectedTemplateId('');
      setNewAutomationConfig(null);
    } catch (err) {
      console.error('Error creating bulk automation:', err);
      alert('Failed to create automations for some properties');
    } finally {
      setSaving(false);
    }
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

  // Save as preset
  const saveAsPreset = async () => {
    if (!automationConfig || !presetName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/automation-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: presetName,
          trigger_type: automationConfig.trigger_type,
          config: {
            schedule: automationConfig.schedule,
            same_day_override: automationConfig.same_day_override,
            auto_assign: automationConfig.auto_assign,
          },
        }),
      });

      if (!res.ok) throw new Error('Failed to save preset');

      const data = await res.json();
      setPresets([data.preset, ...presets]);
      setShowPresetDialog(false);
      setPresetName('');
      setAutomationConfig({ ...automationConfig, preset_id: data.preset.id });
    } catch (err) {
      console.error('Error saving preset:', err);
      alert('Failed to save preset');
    } finally {
      setSaving(false);
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
                  : `${properties.length} properties`
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
        </div>
        
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {properties.map((property) => {
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
                      ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 border-l-4 border-transparent'
                    : isSelected 
                      ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500' 
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 border-l-4 border-transparent'
                }`}
              >
                {bulkEditMode && (
                  <input
                    type="checkbox"
                    checked={isBulkSelected}
                    onChange={() => togglePropertySelection(property)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-neutral-300 text-purple-600 focus:ring-purple-500"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{property}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {automationCount > 0 ? (
                      <Badge className="bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs">
                        {automationCount} automation{automationCount !== 1 ? 's' : ''}
                      </Badge>
                    ) : totalAssignments > 0 ? (
                      <Badge variant="outline" className="text-xs text-neutral-500">
                        {totalAssignments} template{totalAssignments !== 1 ? 's' : ''} (no automation)
                      </Badge>
                    ) : (
                      <span className="text-xs text-neutral-400">No templates</span>
                    )}
                  </div>
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
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">
                    Selected Properties ({selectedProperties.size}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(selectedProperties).map(prop => (
                      <Badge 
                        key={prop} 
                        variant="secondary"
                        className="bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
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
          <div className="p-6">
            {/* Property Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold">{selectedProperty}</h2>
                <p className="text-sm text-neutral-500 mt-1">
                  {selectedPropertyAssignments.length} template{selectedPropertyAssignments.length !== 1 ? 's' : ''} configured
                </p>
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
              <div className="space-y-3">
                {selectedPropertyAssignments.map((assignment) => {
                  const template = getTemplate(assignment.template_id);
                  const config = assignment.automation_config;
                  const hasAutomation = config?.enabled;

                  return (
                    <Card key={assignment.id} className={hasAutomation ? 'border-purple-200 dark:border-purple-800' : ''}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {template?.name || 'Unknown Template'}
                              <Badge 
                                variant="secondary"
                                className={template?.type === 'maintenance' 
                                  ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' 
                                  : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                }
                              >
                                {template?.type || 'unknown'}
                              </Badge>
                            </CardTitle>
                            
                            {/* Status indicators */}
                            <div className="flex items-center gap-3 mt-2 text-xs">
                              <span className={`flex items-center gap-1 ${hasAutomation ? 'text-purple-600 dark:text-purple-400' : 'text-neutral-400'}`}>
                                {hasAutomation ? '✓' : '○'} Auto-gen
                              </span>
                              <span className={`flex items-center gap-1 ${config?.schedule.enabled ? 'text-purple-600 dark:text-purple-400' : 'text-neutral-400'}`}>
                                {config?.schedule.enabled ? '✓' : '○'} Schedule
                              </span>
                              <span className={`flex items-center gap-1 ${config?.auto_assign.enabled ? 'text-purple-600 dark:text-purple-400' : 'text-neutral-400'}`}>
                                {config?.auto_assign.enabled ? '✓' : '○'} Assign
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(assignment)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              onClick={() => deleteAutomation(assignment)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      
                      {hasAutomation && config && (
                        <CardContent className="pt-0 border-t border-neutral-100 dark:border-neutral-800">
                          <div className="flex flex-wrap gap-4 text-xs text-neutral-600 dark:text-neutral-400 pt-3">
                            <div>
                              <span className="font-medium">Trigger:</span> {config.trigger_type}
                            </div>
                            {config.schedule.enabled && (
                              <div>
                                <span className="font-medium">Schedule:</span>{' '}
                                {config.schedule.type === 'on' ? 'On' : `${config.schedule.days_offset}d ${config.schedule.type}`}{' '}
                                {config.schedule.relative_to.replace('_', ' ')}
                              </div>
                            )}
                            {config.auto_assign.enabled && config.auto_assign.user_ids.length > 0 && (
                              <div>
                                <span className="font-medium">Auto-assign:</span>{' '}
                                {config.auto_assign.user_ids.length} user(s)
                              </div>
                            )}
                          </div>
                        </CardContent>
                      )}
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

      {/* Edit Automation Dialog */}
      <Dialog open={!!editingAssignment} onOpenChange={(open) => !open && setEditingAssignment(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Automation</DialogTitle>
            <DialogDescription>
              {editingAssignment?.property_name} → {editingAssignment && getTemplate(editingAssignment.template_id)?.name}
            </DialogDescription>
          </DialogHeader>

          {automationConfig && (
            <AutomationConfigForm
              config={automationConfig}
              onChange={setAutomationConfig}
              users={users}
              presets={presets}
              isNew={false}
              onSavePreset={() => setShowPresetDialog(true)}
            />
          )}

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setEditingAssignment(null)}>
              Cancel
            </Button>
            <Button onClick={saveAutomationConfig} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Template Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Template Automation</DialogTitle>
            <DialogDescription>
              Configure a new template automation for {selectedProperty}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Template Selection */}
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

            {/* Automation Config */}
            {selectedTemplateId && newAutomationConfig && (
              <AutomationConfigForm
                config={newAutomationConfig}
                onChange={setNewAutomationConfig}
                users={users}
                presets={presets}
                isNew={true}
              />
            )}
          </div>

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

      {/* Save Preset Dialog */}
      <Dialog open={showPresetDialog} onOpenChange={setShowPresetDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save Automation Preset</DialogTitle>
            <DialogDescription>
              Save this configuration as a reusable preset.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel>Preset Name</FieldLabel>
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g., Standard Turnover Cleaning"
            />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPresetDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveAsPreset} disabled={saving || !presetName.trim()}>
              {saving ? 'Saving...' : 'Save Preset'}
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
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                Applying to {selectedProperties.size} properties:
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
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
                This template will be added or edited to all selected properties
              </FieldDescription>
            </Field>

            {/* Automation Config */}
            {selectedTemplateId && newAutomationConfig && (
              <AutomationConfigForm
                config={newAutomationConfig}
                onChange={setNewAutomationConfig}
                users={users}
                presets={presets}
                isNew={true}
              />
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setShowBulkAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveBulkAutomation} 
              disabled={saving || !selectedTemplateId}
            >
              {saving ? 'Saving...' : `Apply to ${selectedProperties.size} Properties`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
