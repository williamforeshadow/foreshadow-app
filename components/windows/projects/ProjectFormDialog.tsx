'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project, ProjectFormData, PropertyOption } from '@/lib/types';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useDepartments } from '@/lib/departmentsContext';

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProject: Project | null;
  formData: ProjectFormData;
  setFormData: (data: ProjectFormData | ((prev: ProjectFormData) => ProjectFormData)) => void;
  allProperties: PropertyOption[];
  saving: boolean;
  onSave: () => void;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  editingProject,
  formData,
  setFormData,
  allProperties,
  saving,
  onSave,
}: ProjectFormDialogProps) {
  const isNewProject = !editingProject;
  const [propertyOpen, setPropertyOpen] = React.useState(false);
  const { departments } = useDepartments();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isNewProject ? 'max-w-sm' : undefined}>
        <DialogHeader>
          <DialogTitle>{editingProject ? 'Edit Project' : 'New Project'}</DialogTitle>
          <DialogDescription>
            {editingProject 
              ? 'Update the project details below.' 
              : 'Select a property to create a new project.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Property selector - Combobox for new projects, Select for editing */}
          <div className="space-y-2">
            {editingProject && <Label>Property</Label>}
            {isNewProject ? (
              <Popover open={propertyOpen} onOpenChange={setPropertyOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={propertyOpen}
                    className="w-full justify-between"
                  >
                    {formData.property_name || "Select a property..."}
                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search properties..." />
                    <CommandList>
                      <CommandEmpty>No property found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__no_property__"
                          onSelect={() => {
                            setFormData(prev => ({
                              ...prev,
                              property_name: '',
                              property_id: '',
                            }));
                            setPropertyOpen(false);
                          }}
                        >
                          <CheckIcon
                            className={cn(
                              "mr-2 h-4 w-4",
                              !formData.property_name ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="text-muted-foreground italic">No Property</span>
                        </CommandItem>
                        {allProperties.map((prop) => (
                          <CommandItem
                            key={prop.id || prop.name}
                            value={prop.name}
                            onSelect={() => {
                              setFormData(prev => ({
                                ...prev,
                                property_name: prop.name,
                                property_id: prop.id || '',
                              }));
                              setPropertyOpen(false);
                            }}
                          >
                            <CheckIcon
                              className={cn(
                                "mr-2 h-4 w-4",
                                formData.property_name === prop.name ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {prop.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Select
                value={formData.property_name}
                onValueChange={(value) => {
                  const match = allProperties.find(p => p.name === value);
                  setFormData(prev => ({
                    ...prev,
                    property_name: value,
                    property_id: match?.id || '',
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a property" />
                </SelectTrigger>
                <SelectContent>
                  {allProperties.map((prop) => (
                    <SelectItem key={prop.id || prop.name} value={prop.name}>{prop.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Full form only shown when editing existing project */}
          {editingProject && (
            <>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Project title"
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2">
                  <RichTextEditor
                    content={formData.description}
                    onChange={(json) => setFormData(prev => ({ ...prev, description: json }))}
                    placeholder="Optional description..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Not Started</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={formData.department_id || 'none'}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, department_id: value === 'none' ? '' : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Department</SelectItem>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Scheduled Date</Label>
                <Input
                  type="date"
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Scheduled Time</Label>
                <Input
                  type="time"
                  value={formData.scheduled_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduled_time: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || (!!editingProject && !formData.title)}
          >
            {saving ? 'Creating...' : editingProject ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
