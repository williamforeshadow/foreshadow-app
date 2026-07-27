'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import {
  ChipButton,
  FieldRow,
  MetaChip,
  RowIconButton,
  SectionLabel,
} from '@/components/ui/panel/PanelForm';
import { DeptGlyph } from '@/components/tasks/DeptGlyph';
import { useDepartments } from '@/lib/departmentsContext';
import {
  type PropertyTemplateAssignment,
  createDefaultAutomationConfig,
} from '@/lib/types';


interface Template {
  id: string;
  name: string;
  department_id?: string | null;
  department_name?: string | null;
  description: string | null;
}

interface AutomationsViewProps {
  templates: Template[];
  properties: string[];
}

const ICONS = {
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
    </svg>
  ),
  template: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
    </svg>
  ),
  plus: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  sliders: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" /><circle cx="16" cy="8" r="2" /><circle cx="10" cy="16" r="2" />
    </svg>
  ),
  trash: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l.9 12.1A2 2 0 008.9 21h6.2a2 2 0 002-1.9L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  ),
};

/** The detail column's width — matched to the Configure Automation and
 *  Property Fields pages so the three line up as you move between them. */
const DETAIL_COL = 'w-full max-w-[46rem]';

export default function AutomationsView({ templates, properties }: AutomationsViewProps) {
  const router = useRouter();
  const { deptIconMap } = useDepartments();

  // Data state
  const [assignments, setAssignments] = useState<PropertyTemplateAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add new automation state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [bulkTemplatePickerOpen, setBulkTemplatePickerOpen] = useState(false);

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
      const res = await fetch('/api/property-templates');
      const data = await res.json();
      if (data.assignments) setAssignments(data.assignments);
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
  const selectedPropertyAssignments = useMemo(
    () => (selectedProperty ? assignmentsByProperty[selectedProperty] || [] : []),
    [selectedProperty, assignmentsByProperty]
  );

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
    setShowBulkAddDialog(true);
  };

  // Navigate to bulk configure page
  const saveBulkAutomation = () => {
    if (selectedProperties.size === 0 || !selectedTemplateId) return;

    const propertiesParam = encodeURIComponent(Array.from(selectedProperties).join(','));
    setShowBulkAddDialog(false);
    router.push(`/automations/tasks/bulk-configure?properties=${propertiesParam}&template=${encodeURIComponent(selectedTemplateId)}`);
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

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  if (loading) {
    return (
      <div className="panel-form flex h-full items-center justify-center" style={{ background: 'var(--task-surface-0)' }}>
        <p className="font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
          Loading automations…
        </p>
      </div>
    );
  }

  return (
    <div className="panel-form flex h-full" style={{ background: 'var(--task-surface-0)' }}>
      {/* ── Left: properties ── */}
      <div className="flex w-80 shrink-0 flex-col border-r" style={{ borderColor: 'var(--task-line-soft)' }}>
        <div className="shrink-0 border-b pb-3" style={{ borderColor: 'var(--task-line-soft)' }}>
          <div className="flex items-center justify-between gap-2 px-[18px] pt-4">
            <SectionLabel className="!px-0 !pt-0 !pb-0">
              {bulkEditMode && selectedProperties.size > 0
                ? `${selectedProperties.size} selected`
                : `${filteredProperties.length} properties`}
            </SectionLabel>
            <ChipButton
              set={bulkEditMode}
              onClick={() => {
                setBulkEditMode(!bulkEditMode);
                setSelectedProperties(new Set());
              }}
            >
              {bulkEditMode ? 'Done' : 'Bulk edit'}
            </ChipButton>
          </div>

          <div className="mt-2.5 px-[18px]">
            <div
              className="flex h-[34px] items-center gap-2 rounded-lg px-2.5"
              style={{ background: 'var(--task-surface-1)' }}
            >
              <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>{ICONS.search}</span>
              <input
                placeholder="Search properties…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[length:var(--task-fs-body-sm)] outline-none placeholder:text-[var(--task-ink-3)]"
                style={{ color: 'var(--task-ink-1)' }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredProperties.map((property) => {
            const automationCount = getAutomationCount(property);
            const totalAssignments = assignmentsByProperty[property]?.length || 0;
            const isSelected = selectedProperty === property;
            const isBulkSelected = selectedProperties.has(property);
            const active = bulkEditMode ? isBulkSelected : isSelected;

            return (
              <button
                key={property}
                type="button"
                onClick={() => bulkEditMode ? togglePropertySelection(property) : setSelectedProperty(property)}
                aria-pressed={active}
                className="flex w-full items-center gap-2.5 border-b py-2.5 pr-[18px] text-left transition-colors hover:bg-[var(--task-surface-1)]"
                style={{
                  borderColor: 'var(--task-line-soft)',
                  background: active ? 'var(--task-surface-1)' : undefined,
                  // 2px accent rule marks the current row; transparent keeps
                  // every label on the same left edge.
                  borderLeft: `2px solid ${active ? 'var(--task-accent)' : 'transparent'}`,
                  paddingLeft: 16,
                }}
              >
                {bulkEditMode && (
                  <span
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border"
                    style={{
                      background: isBulkSelected ? 'var(--task-accent)' : 'transparent',
                      borderColor: isBulkSelected ? 'var(--task-accent)' : 'var(--task-line)',
                      color: '#fff',
                    }}
                  >
                    {isBulkSelected && ICONS.check}
                  </span>
                )}
                <span
                  className="min-w-0 flex-1 truncate text-[length:var(--task-fs-body-sm)]"
                  style={{ color: active ? 'var(--task-ink-1)' : 'var(--task-ink-2)' }}
                >
                  {property}
                </span>
                {/* Accent = live automations; neutral = configured but all off. */}
                {automationCount > 0 ? (
                  <MetaChip tone="accent">{automationCount}</MetaChip>
                ) : totalAssignments > 0 ? (
                  <MetaChip>{totalAssignments}</MetaChip>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: detail, capped to a readable column ── */}
      <div className="flex-1 overflow-y-auto">
        {bulkEditMode ? (
          // BULK MODE VIEW
          <div className={DETAIL_COL}>
            <div className="flex items-center justify-between gap-3 border-b px-[18px] py-3" style={{ borderColor: 'var(--task-line-soft)' }}>
              <div className="min-w-0">
                <div className="truncate text-[length:var(--task-fs-option)] font-medium" style={{ color: 'var(--task-ink-1)' }}>
                  {selectedProperties.size > 0
                    ? `Add template to ${selectedProperties.size} properties`
                    : 'Select properties'}
                </div>
                <div className="truncate text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
                  {selectedProperties.size > 0
                    ? Array.from(selectedProperties).slice(0, 3).join(', ') + (selectedProperties.size > 3 ? `, and ${selectedProperties.size - 3} more` : '')
                    : 'Check properties on the left to apply bulk automation'}
                </div>
              </div>
              {selectedProperties.size > 0 && (
                <div className="flex shrink-0 gap-1.5">
                  <ChipButton set={false} onClick={() => setSelectedProperties(new Set())}>
                    Clear
                  </ChipButton>
                  <ChipButton set={false} onClick={() => setSelectedProperties(new Set(properties))}>
                    Select all
                  </ChipButton>
                </div>
              )}
            </div>

            {selectedProperties.size === 0 ? (
              <div className="px-[18px] py-12 text-center">
                <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                  No properties selected.
                </p>
                <p className="mt-1.5 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
                  Use the checkboxes on the left to select properties for bulk automation.
                </p>
              </div>
            ) : (
              <>
                <SectionLabel>Selected properties ({selectedProperties.size})</SectionLabel>
                <div className="flex flex-wrap gap-1.5 border-b px-[18px] pb-3" style={{ borderColor: 'var(--task-line-soft)' }}>
                  {Array.from(selectedProperties).map(prop => (
                    <MetaChip key={prop}>{prop}</MetaChip>
                  ))}
                </div>

                <div className="px-[18px] py-4">
                  <button
                    type="button"
                    onClick={openBulkAddDialog}
                    className="h-[46px] w-full rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.99]"
                    style={{ background: 'var(--task-accent)', color: '#fff' }}
                  >
                    Add or edit template for {selectedProperties.size} properties
                  </button>
                </div>
              </>
            )}
          </div>
        ) : selectedProperty ? (
          // SINGLE PROPERTY VIEW
          <div className={DETAIL_COL}>
            <div className="flex items-center justify-between gap-3 border-b px-[18px] py-3" style={{ borderColor: 'var(--task-line-soft)' }}>
              <div className="min-w-0 truncate text-[length:var(--task-fs-option)] font-medium" style={{ color: 'var(--task-ink-1)' }}>
                {selectedProperty}
              </div>
              <ChipButton
                set
                onClick={openAddDialog}
                disabled={availableTemplates.length === 0}
                style={availableTemplates.length === 0 ? { opacity: 0.45 } : undefined}
              >
                + Add template
              </ChipButton>
            </div>

            {selectedPropertyAssignments.length === 0 ? (
              <div className="px-[18px] py-12 text-center">
                <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                  No templates configured for this property.
                </p>
                <p className="mt-1.5 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
                  Click &quot;Add template&quot; to configure task automations.
                </p>
              </div>
            ) : (
              <>
                <SectionLabel>Template automations</SectionLabel>
                {selectedPropertyAssignments.map((assignment) => {
                  const template = getTemplate(assignment.template_id);
                  const hasOverrides = !!(
                    assignment.field_overrides &&
                    (assignment.field_overrides.additional_fields?.length > 0 ||
                      assignment.field_overrides.removed_field_ids?.length > 0 ||
                      Object.keys(assignment.field_overrides.modified_fields ?? {}).length > 0)
                  );
                  const isLive = !!assignment.automation_config?.enabled;

                  return (
                    <div
                      key={assignment.id}
                      className="group flex items-center gap-2.5 border-b px-[18px] py-2.5 transition-colors hover:bg-[var(--task-surface-1)]"
                      style={{ borderColor: 'var(--task-line-soft)' }}
                    >
                      {/* The row itself opens the configure page; the two
                          affordances on the right stop propagation. */}
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/automations/tasks/configure?property=${encodeURIComponent(assignment.property_name)}&template=${encodeURIComponent(assignment.template_id)}`
                          )
                        }
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span className="shrink-0">
                          <DeptGlyph
                            iconKey={template?.department_id ? deptIconMap[template.department_id] : null}
                            size={17}
                            muted={!isLive}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-[length:var(--task-fs-option)]"
                            style={{ color: 'var(--task-ink-1)' }}
                          >
                            {template?.name || 'Unknown Template'}
                          </span>
                          <span
                            className="block truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.1em]"
                            style={{ color: 'var(--task-ink-3)' }}
                          >
                            {template?.department_name || 'Uncategorized'}
                          </span>
                        </span>
                        {isLive && <MetaChip tone="accent">Live</MetaChip>}
                        {hasOverrides && <MetaChip>Customized</MetaChip>}
                      </button>

                      <RowIconButton
                        label="Property fields"
                        onClick={() =>
                          router.push(
                            `/automations/tasks/fields?property=${encodeURIComponent(assignment.property_name)}&template=${encodeURIComponent(assignment.template_id)}`
                          )
                        }
                      >
                        {ICONS.sliders}
                      </RowIconButton>
                      <RowIconButton
                        danger
                        label="Remove automation"
                        onClick={() => deleteAutomation(assignment)}
                      >
                        {ICONS.trash}
                      </RowIconButton>
                      <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>{ICONS.chevron}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
              Select a property to view its automations
            </p>
          </div>
        )}
      </div>

      {/* Add Template Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="panel-form max-w-md p-0" style={{ background: 'var(--task-surface-0)' }}>
          <DialogHeader className="px-[18px] pt-4">
            <DialogTitle className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-1)' }}>
              Add Template Automation
            </DialogTitle>
            <DialogDescription className="text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
              Configure a new template automation for {selectedProperty}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            <SectionLabel>Template</SectionLabel>
            <AdaptivePicker
              open={templatePickerOpen}
              onOpenChange={setTemplatePickerOpen}
              title="Template"
              trigger={
                <FieldRow
                  icon={ICONS.template}
                  value={selectedTemplate?.name}
                  placeholder="Choose a template…"
                />
              }
            >
              {availableTemplates.map((template) => (
                <TaskOptionRow
                  key={template.id}
                  selected={template.id === selectedTemplateId}
                  onSelect={() => {
                    setSelectedTemplateId(template.id);
                    setTemplatePickerOpen(false);
                  }}
                >
                  {template.name}
                  {template.department_name ? ` · ${template.department_name}` : ''}
                </TaskOptionRow>
              ))}
            </AdaptivePicker>
            {availableTemplates.length === 0 && (
              <div className="px-[18px] py-2 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-amber)' }}>
                All templates are already assigned to this property.
              </div>
            )}
          </div>

          <DialogFooter className="flex-row gap-2 px-[18px] pb-4">
            <button
              type="button"
              onClick={() => setShowAddDialog(false)}
              className="h-[46px] shrink-0 rounded-xl border px-5 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
              style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveNewAutomation}
              disabled={saving || !selectedTemplateId}
              className="h-[46px] flex-1 rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--task-accent)', color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Add Template'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Add/Edit Template Dialog */}
      <Dialog open={showBulkAddDialog} onOpenChange={setShowBulkAddDialog}>
        <DialogContent className="panel-form max-w-md p-0" style={{ background: 'var(--task-surface-0)' }}>
          <DialogHeader className="px-[18px] pt-4">
            <DialogTitle className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-1)' }}>
              Add or Edit Template Automation
            </DialogTitle>
            <DialogDescription className="text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
              Configure automation for {selectedProperties.size} selected properties
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            <SectionLabel>Applying to {selectedProperties.size} properties</SectionLabel>
            <div className="flex flex-wrap gap-1.5 border-b px-[18px] pb-3" style={{ borderColor: 'var(--task-line-soft)' }}>
              {Array.from(selectedProperties).map((prop) => (
                <MetaChip key={prop}>{prop}</MetaChip>
              ))}
            </div>

            <SectionLabel>Template</SectionLabel>
            <AdaptivePicker
              open={bulkTemplatePickerOpen}
              onOpenChange={setBulkTemplatePickerOpen}
              title="Template"
              trigger={
                <FieldRow
                  icon={ICONS.template}
                  value={selectedTemplate?.name}
                  placeholder="Choose a template…"
                />
              }
            >
              {templates.map((template) => (
                <TaskOptionRow
                  key={template.id}
                  selected={template.id === selectedTemplateId}
                  onSelect={() => {
                    setSelectedTemplateId(template.id);
                    setBulkTemplatePickerOpen(false);
                  }}
                >
                  {template.name}
                  {template.department_name ? ` · ${template.department_name}` : ''}
                </TaskOptionRow>
              ))}
            </AdaptivePicker>
            <div className="px-[18px] py-2 text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-3)' }}>
              This template will be added to all selected properties with default settings
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 px-[18px] pb-4">
            <button
              type="button"
              onClick={() => setShowBulkAddDialog(false)}
              className="h-[46px] shrink-0 rounded-xl border px-5 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
              style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveBulkAutomation}
              disabled={!selectedTemplateId}
              className="h-[46px] flex-1 rounded-xl font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--task-accent)', color: '#fff' }}
            >
              {`Configure for ${selectedProperties.size} Properties`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
