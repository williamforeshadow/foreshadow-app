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
  type AutomationTriggerType,
  type AutomationScheduleType,
  type AutomationScheduleRelativeTo,
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
    const config = assignment.automation_config || createDefaultAutomationConfig();
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

  // Config update helpers
  const updateConfig = <K extends keyof AutomationConfig>(key: K, value: AutomationConfig[K]) => {
    if (!automationConfig) return;
    setAutomationConfig({ ...automationConfig, [key]: value });
  };

  const updateSchedule = (field: string, value: unknown) => {
    if (!automationConfig) return;
    setAutomationConfig({
      ...automationConfig,
      schedule: { ...automationConfig.schedule, [field]: value }
    });
  };

  const updateSameDaySchedule = (field: string, value: unknown) => {
    if (!automationConfig) return;
    setAutomationConfig({
      ...automationConfig,
      same_day_override: {
        ...automationConfig.same_day_override,
        schedule: { ...automationConfig.same_day_override.schedule, [field]: value }
      }
    });
  };

  const updateAutoAssign = (field: string, value: unknown) => {
    if (!automationConfig) return;
    setAutomationConfig({
      ...automationConfig,
      auto_assign: { ...automationConfig.auto_assign, [field]: value }
    });
  };

  // New automation config helpers
  const updateNewConfig = <K extends keyof AutomationConfig>(key: K, value: AutomationConfig[K]) => {
    if (!newAutomationConfig) return;
    setNewAutomationConfig({ ...newAutomationConfig, [key]: value });
  };

  const updateNewSchedule = (field: string, value: unknown) => {
    if (!newAutomationConfig) return;
    setNewAutomationConfig({
      ...newAutomationConfig,
      schedule: { ...newAutomationConfig.schedule, [field]: value }
    });
  };

  const updateNewSameDaySchedule = (field: string, value: unknown) => {
    if (!newAutomationConfig) return;
    setNewAutomationConfig({
      ...newAutomationConfig,
      same_day_override: {
        ...newAutomationConfig.same_day_override,
        schedule: { ...newAutomationConfig.same_day_override.schedule, [field]: value }
      }
    });
  };

  const updateNewAutoAssign = (field: string, value: unknown) => {
    if (!newAutomationConfig) return;
    setNewAutomationConfig({
      ...newAutomationConfig,
      auto_assign: { ...newAutomationConfig.auto_assign, [field]: value }
    });
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

      if (!res.ok) throw new Error('Failed to save automation config');

      await fetchData();
      setEditingAssignment(null);
      setAutomationConfig(null);
    } catch (err) {
      console.error('Error saving automation config:', err);
      alert('Failed to save automation configuration');
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

  // Load preset
  const loadPreset = (preset: AutomationPreset, isNew: boolean = false) => {
    const config = isNew ? newAutomationConfig : automationConfig;
    const setConfig = isNew ? setNewAutomationConfig : setAutomationConfig;
    
    if (!config) return;
    setConfig({
      ...config,
      trigger_type: preset.trigger_type,
      schedule: preset.config.schedule,
      same_day_override: preset.config.same_day_override,
      auto_assign: preset.config.auto_assign,
      preset_id: preset.id,
    });
  };

  // Toggle user assignment
  const toggleUserAssignment = (userId: string, isNew: boolean = false) => {
    const config = isNew ? newAutomationConfig : automationConfig;
    const updateFn = isNew ? updateNewAutoAssign : updateAutoAssign;
    
    if (!config) return;
    const currentIds = config.auto_assign.user_ids;
    const newIds = currentIds.includes(userId)
      ? currentIds.filter(id => id !== userId)
      : [...currentIds, userId];
    updateFn('user_ids', newIds);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-neutral-500">
        Loading automations...
      </div>
    );
  }

  // Render automation config form (reusable for both edit and add dialogs)
  const renderAutomationForm = (config: AutomationConfig, isNew: boolean = false) => {
    const updateConfigFn = isNew ? updateNewConfig : updateConfig;
    const updateScheduleFn = isNew ? updateNewSchedule : updateSchedule;
    const updateSameDayFn = isNew ? updateNewSameDaySchedule : updateSameDaySchedule;
    const updateAutoAssignFn = isNew ? updateNewAutoAssign : updateAutoAssign;

    return (
      <div className="space-y-6">
        {/* Enable Automation Toggle */}
        <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
          <div>
            <div className="font-medium">Enable Auto-generation</div>
            <div className="text-sm text-neutral-500">Automatically create tasks when turnover occurs</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled}
            onClick={() => updateConfigFn('enabled', !config.enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.enabled ? 'bg-purple-600' : 'bg-neutral-300 dark:bg-neutral-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {config.enabled && (
          <>
            {/* Trigger Type */}
            <Field>
              <FieldLabel>Trigger Type</FieldLabel>
              <Select
                value={config.trigger_type}
                onValueChange={(value) => updateConfigFn('trigger_type', value as AutomationTriggerType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="turnover">Turnover Association</SelectItem>
                  <SelectItem value="occupancy" disabled>Occupancy Period (coming soon)</SelectItem>
                  <SelectItem value="vacancy" disabled>Vacancy Period (coming soon)</SelectItem>
                  <SelectItem value="recurring" disabled>Recurring (coming soon)</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>When should this task be generated?</FieldDescription>
            </Field>

            {/* Schedule Configuration */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Auto-Scheduling</div>
                  <div className="text-xs text-neutral-500">Automatically set task scheduled time</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.schedule.enabled}
                  onClick={() => updateScheduleFn('enabled', !config.schedule.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    config.schedule.enabled ? 'bg-purple-600' : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.schedule.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {config.schedule.enabled && (
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <Field>
                    <FieldLabel className="text-xs">When</FieldLabel>
                    <Select
                      value={config.schedule.type}
                      onValueChange={(value) => updateScheduleFn('type', value as AutomationScheduleType)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="before">Before</SelectItem>
                        <SelectItem value="after">After</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {config.schedule.type !== 'on' && (
                    <Field>
                      <FieldLabel className="text-xs">Days</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={config.schedule.days_offset}
                        onChange={(e) => updateScheduleFn('days_offset', parseInt(e.target.value) || 0)}
                        className="h-9"
                      />
                    </Field>
                  )}

                  <Field>
                    <FieldLabel className="text-xs">Relative to</FieldLabel>
                    <Select
                      value={config.schedule.relative_to}
                      onValueChange={(value) => updateScheduleFn('relative_to', value as AutomationScheduleRelativeTo)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="check_out">Check Out</SelectItem>
                        <SelectItem value="next_check_in">Next Check In</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
            </div>

            {/* Same-Day Override */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Same-Day Turnover Override</div>
                  <div className="text-xs text-neutral-500">Different scheduling when check-out and next check-in are same day</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.same_day_override.enabled}
                  onClick={() => {
                    if (isNew && newAutomationConfig) {
                      setNewAutomationConfig({
                        ...newAutomationConfig,
                        same_day_override: {
                          ...newAutomationConfig.same_day_override,
                          enabled: !newAutomationConfig.same_day_override.enabled
                        }
                      });
                    } else if (automationConfig) {
                      setAutomationConfig({
                        ...automationConfig,
                        same_day_override: {
                          ...automationConfig.same_day_override,
                          enabled: !automationConfig.same_day_override.enabled
                        }
                      });
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    config.same_day_override.enabled ? 'bg-purple-600' : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.same_day_override.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {config.same_day_override.enabled && (
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <Field>
                    <FieldLabel className="text-xs">When</FieldLabel>
                    <Select
                      value={config.same_day_override.schedule.type}
                      onValueChange={(value) => updateSameDayFn('type', value as AutomationScheduleType)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="before">Before</SelectItem>
                        <SelectItem value="after">After</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {config.same_day_override.schedule.type !== 'on' && (
                    <Field>
                      <FieldLabel className="text-xs">Days</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={config.same_day_override.schedule.days_offset}
                        onChange={(e) => updateSameDayFn('days_offset', parseInt(e.target.value) || 0)}
                        className="h-9"
                      />
                    </Field>
                  )}

                  <Field>
                    <FieldLabel className="text-xs">Relative to</FieldLabel>
                    <Select
                      value={config.same_day_override.schedule.relative_to}
                      onValueChange={(value) => updateSameDayFn('relative_to', value as AutomationScheduleRelativeTo)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="check_out">Check Out</SelectItem>
                        <SelectItem value="next_check_in">Next Check In</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
            </div>

            {/* Auto-Assign */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Auto-Assign Users</div>
                  <div className="text-xs text-neutral-500">Automatically assign users to generated tasks</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.auto_assign.enabled}
                  onClick={() => updateAutoAssignFn('enabled', !config.auto_assign.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    config.auto_assign.enabled ? 'bg-purple-600' : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.auto_assign.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {config.auto_assign.enabled && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {users.map((user) => {
                    const isSelected = config.auto_assign.user_ids.includes(user.id);
                    return (
                      <label
                        key={user.id}
                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700' 
                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleUserAssignment(user.id, isNew)}
                          className="rounded border-neutral-300"
                        />
                        <span className="text-lg">{user.avatar || '👤'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{user.name}</div>
                          <div className="text-xs text-neutral-500 truncate">{user.role}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Preset Actions (only for edit dialog) */}
            {!isNew && (
              <div className="flex items-center gap-2 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPresetDialog(true)}
                >
                  Save as Preset
                </Button>
                {presets.length > 0 && (
                  <Select onValueChange={(presetId) => {
                    const preset = presets.find(p => p.id === presetId);
                    if (preset) loadPreset(preset, false);
                  }}>
                    <SelectTrigger className="w-48 h-9">
                      <SelectValue placeholder="Load preset..." />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Preset Actions for new dialog */}
            {isNew && presets.length > 0 && (
              <div className="flex items-center gap-2 pt-4 border-t">
                <Select onValueChange={(presetId) => {
                  const preset = presets.find(p => p.id === presetId);
                  if (preset) loadPreset(preset, true);
                }}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue placeholder="Load preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full -m-6">
      {/* Left Panel - Properties List */}
      <div className="w-80 border-r border-neutral-200 dark:border-neutral-700 overflow-y-auto">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
          <h3 className="font-medium text-sm text-neutral-700 dark:text-neutral-300">Properties</h3>
          <p className="text-xs text-neutral-500 mt-1">{properties.length} properties</p>
        </div>
        
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {properties.map((property) => {
            const automationCount = getAutomationCount(property);
            const totalAssignments = assignmentsByProperty[property]?.length || 0;
            const isSelected = selectedProperty === property;
            
            return (
              <button
                key={property}
                onClick={() => setSelectedProperty(property)}
                className={`w-full text-left p-4 transition-colors ${
                  isSelected 
                    ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500' 
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 border-l-4 border-transparent'
                }`}
              >
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
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Panel - Property Detail */}
      <div className="flex-1 overflow-y-auto">
        {selectedProperty ? (
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

          {automationConfig && renderAutomationForm(automationConfig, false)}

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
            {selectedTemplateId && newAutomationConfig && renderAutomationForm(newAutomationConfig, true)}
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
    </div>
  );
}
