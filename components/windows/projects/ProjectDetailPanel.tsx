'use client';

import { RefObject, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DebouncedNativeInput, DebouncedTextarea } from '@/components/ui/debounced-input';
import { CheckIcon } from 'lucide-react';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { Project, User, ProjectFormFields, Comment, Attachment, TimeEntry, PropertyOption } from '@/lib/types';

interface ProjectDetailPanelProps {
  project: Project;
  editingFields: ProjectFormFields;
  setEditingFields: (fields: ProjectFormFields | null | ((prev: ProjectFormFields | null) => ProjectFormFields | null)) => void;
  users: User[];
  allProperties?: PropertyOption[];
  savingEdit: boolean;
  onSave: () => void;
  onDelete: (project: Project) => void;
  onClose: () => void;
  onOpenActivity: () => void;
  onPropertyChange?: (propertyId: string | null, propertyName: string | null) => void;
  // Comments
  comments: Comment[];
  loadingComments: boolean;
  newComment: string;
  setNewComment: (comment: string) => void;
  postingComment: boolean;
  onPostComment: () => void;
  // Attachments
  attachments: Attachment[];
  loadingAttachments: boolean;
  uploadingAttachment: boolean;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  onAttachmentUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onViewAttachment: (index: number) => void;
  // Time tracking
  activeTimeEntry: TimeEntry | null;
  displaySeconds: number;
  formatTime: (seconds: number) => string;
  onStartTimer: () => void;
  onStopTimer: () => void;
  // Popover states
  staffOpen: boolean;
  setStaffOpen: (open: boolean) => void;
}

export function ProjectDetailPanel({
  project,
  editingFields,
  setEditingFields,
  users,
  allProperties = [],
  savingEdit,
  onSave,
  onDelete,
  onClose,
  onOpenActivity,
  onPropertyChange,
  comments,
  loadingComments,
  newComment,
  setNewComment,
  postingComment,
  onPostComment,
  attachments,
  loadingAttachments,
  uploadingAttachment,
  attachmentInputRef,
  onAttachmentUpload,
  onViewAttachment,
  activeTimeEntry,
  displaySeconds,
  formatTime,
  onStartTimer,
  onStopTimer,
  staffOpen,
  setStaffOpen,
}: ProjectDetailPanelProps) {
  const { departments } = useDepartments();
  const [propertyOpen, setPropertyOpen] = useState(false);

  // Derived data
  const assignedUser = users.find(u => u.id === editingFields.assigned_staff);
  const dept = departments.find(d => d.id === editingFields.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);

  // Status config
  const statusConfig: Record<string, { bg: string; dot: string; label: string }> = {
    not_started: { bg: 'bg-amber-500/15 text-amber-400', dot: 'bg-amber-400', label: 'Not Started' },
    in_progress: { bg: 'bg-blue-500/15 text-blue-400', dot: 'bg-blue-400', label: 'In Progress' },
    on_hold: { bg: 'bg-orange-500/15 text-orange-400', dot: 'bg-orange-400', label: 'On Hold' },
    complete: { bg: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400', label: 'Complete' },
  };

  // Priority config
  const priorityConfig: Record<string, { bg: string; label: string }> = {
    low: { bg: 'bg-slate-500/15 text-slate-400', label: 'Low' },
    medium: { bg: 'bg-sky-500/15 text-sky-400', label: 'Medium' },
    high: { bg: 'bg-red-500/15 text-red-300', label: 'High' },
    urgent: { bg: 'bg-red-500/20 text-red-400', label: 'Urgent' },
  };

  const status = statusConfig[editingFields.status] || statusConfig.not_started;
  const priority = priorityConfig[editingFields.priority] || priorityConfig.medium;

  return (
    <div className="w-full h-full flex flex-col bg-card">
      {/* ── Top actions (activity, delete, close) ── */}
      <div className="flex-shrink-0 flex items-center justify-end gap-0.5 px-3 pt-2">
        <button
          onClick={onOpenActivity}
          className="p-1.5 hover:bg-muted rounded-md transition-colors"
          title="Activity History"
        >
          <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button
          onClick={() => { if (confirm('Are you sure you want to delete this project?')) onDelete(project); }}
          className="p-1.5 hover:bg-red-500/10 rounded-md transition-colors"
          title="Delete project"
        >
          <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-muted rounded-md transition-colors"
          title="Close"
        >
          <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <ScrollArea className="flex-1 min-h-0 overscroll-contain">
        <div className="px-5 pb-4">

          {/* ── Header: Department icon + Title + Property ── */}
          <div className="flex items-start gap-3.5 mb-5">
            {/* Department icon — large, clickable */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-[42px] h-[42px] rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:opacity-80"
                  style={{ backgroundColor: dept ? 'rgba(133,183,235,0.12)' : 'rgba(255,255,255,0.06)' }}
                  title={dept?.name || 'No Department — click to assign'}
                >
                  <DeptIcon className="w-5 h-5" style={{ color: dept ? '#85B7EB' : '#6a6a72' }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuCheckboxItem
                  checked={!editingFields.department_id}
                  onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, department_id: ''} : null); setTimeout(onSave, 0); }}
                >
                  No Department
                </DropdownMenuCheckboxItem>
                {departments.map((d) => {
                  const DIcon = getDepartmentIcon(d.icon);
                  return (
                    <DropdownMenuCheckboxItem
                      key={d.id}
                      checked={editingFields.department_id === d.id}
                      onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, department_id: d.id} : null); setTimeout(onSave, 0); }}
                    >
                      <span className="flex items-center gap-2">
                        <DIcon className="w-3.5 h-3.5" />
                        {d.name}
                      </span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1 min-w-0 pt-0.5">
              {/* Title */}
              <DebouncedNativeInput
                type="text"
                value={editingFields.title}
                onChange={(value) => setEditingFields(prev => prev ? {...prev, title: value} : null)}
                onBlur={onSave}
                placeholder="Untitled Project"
                className="text-[17px] font-medium bg-transparent border-none outline-none focus:outline-none p-0 w-full min-w-0 text-foreground placeholder:text-muted-foreground leading-snug"
                delay={150}
              />
              {/* Property — clickable to change */}
              <Popover open={propertyOpen} onOpenChange={setPropertyOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors group">
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 3.375 4.5 8.5 4.5 8.5s4.5-5.125 4.5-8.5A4.5 4.5 0 008 1.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                    </svg>
                    <span className="truncate">{project.property_name || 'No property'}</span>
                    <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search properties..." />
                    <CommandList>
                      <CommandEmpty>No properties found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__no_property__"
                          onSelect={() => {
                            onPropertyChange?.(null, null);
                            setPropertyOpen(false);
                          }}
                        >
                          <CheckIcon className={cn("mr-2 h-4 w-4", !project.property_name ? "opacity-100" : "opacity-0")} />
                          <span className="text-muted-foreground italic">No Property</span>
                        </CommandItem>
                        {allProperties.map((prop) => (
                          <CommandItem
                            key={prop.id || prop.name}
                            value={prop.name}
                            onSelect={() => {
                              onPropertyChange?.(prop.id || null, prop.name);
                              setPropertyOpen(false);
                            }}
                          >
                            <CheckIcon className={cn("mr-2 h-4 w-4", project.property_name === prop.name ? "opacity-100" : "opacity-0")} />
                            {prop.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* ── Status / Priority / Department pills ── */}
          <div className="flex flex-wrap gap-2 mb-5">
            {/* Status pill */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-80", status.bg)}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                  {status.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {Object.entries(statusConfig).map(([key, cfg]) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={editingFields.status === key}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, status: key} : null); setTimeout(onSave, 0); }}
                  >
                    {cfg.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Priority pill */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-80", priority.bg)}>
                  <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M5 0l1.5 3.5L10 4l-2.5 2.5L8 10 5 8l-3 2 .5-3.5L0 4l3.5-.5z" />
                  </svg>
                  {priority.label} priority
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {Object.entries(priorityConfig).map(([key, cfg]) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={editingFields.priority === key}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, priority: key} : null); setTimeout(onSave, 0); }}
                  >
                    {cfg.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Department pill (only show if set) */}
            {dept && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-sky-500/12 text-sky-300 transition-opacity hover:opacity-80">
                    <DeptIcon className="w-3 h-3" />
                    {dept.name}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuCheckboxItem
                    checked={!editingFields.department_id}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, department_id: ''} : null); setTimeout(onSave, 0); }}
                  >
                    No Department
                  </DropdownMenuCheckboxItem>
                  {departments.map((d) => {
                    const DIcon = getDepartmentIcon(d.icon);
                    return (
                      <DropdownMenuCheckboxItem
                        key={d.id}
                        checked={editingFields.department_id === d.id}
                        onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, department_id: d.id} : null); setTimeout(onSave, 0); }}
                      >
                        <span className="flex items-center gap-2">
                          <DIcon className="w-3.5 h-3.5" />
                          {d.name}
                        </span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* ── Description card ── */}
          <div className="rounded-xl bg-muted/50 px-4 py-3.5 mb-4">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Description</div>
            <DebouncedTextarea
              value={editingFields.description}
              onChange={(value) => setEditingFields(prev => prev ? {...prev, description: value} : null)}
              onBlur={onSave}
              placeholder="Add a description..."
              rows={2}
              className="resize-none bg-transparent border-none p-0 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0"
              delay={150}
            />
          </div>

          {/* ── Assigned + Scheduled grid ── */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Assigned to */}
            <div className="rounded-xl bg-muted/50 px-4 py-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Assigned to</div>
              <Popover open={staffOpen} onOpenChange={setStaffOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2.5 w-full hover:opacity-80 transition-opacity">
                    {assignedUser ? (
                      <>
                        {assignedUser.avatar ? (
                          <img
                            src={assignedUser.avatar}
                            alt={assignedUser.name}
                            className="w-7 h-7 rounded-full object-cover ring-2 ring-background flex-shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-blue-500/15 flex items-center justify-center text-[11px] font-medium text-blue-400 flex-shrink-0">
                            {assignedUser.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="text-[13px] font-medium text-foreground truncate">{assignedUser.name}</span>
                      </>
                    ) : (
                      <>
                        <div className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center flex-shrink-0">
                          <svg className="w-3.5 h-3.5 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                        <span className="text-[13px] text-muted-foreground">Unassigned</span>
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search staff..." />
                    <CommandList>
                      <CommandEmpty>No staff found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="unassigned"
                          onSelect={() => {
                            setEditingFields(prev => prev ? {...prev, assigned_staff: ''} : null);
                            setStaffOpen(false);
                            setTimeout(onSave, 0);
                          }}
                        >
                          <CheckIcon className={cn("mr-2 h-4 w-4", !editingFields.assigned_staff ? "opacity-100" : "opacity-0")} />
                          Unassigned
                        </CommandItem>
                        {users.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={user.name}
                            onSelect={() => {
                              setEditingFields(prev => prev ? {...prev, assigned_staff: user.id} : null);
                              setStaffOpen(false);
                              setTimeout(onSave, 0);
                            }}
                          >
                            <CheckIcon className={cn("mr-2 h-4 w-4", editingFields.assigned_staff === user.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex items-center gap-2">
                              {user.avatar ? (
                                <img src={user.avatar} alt={user.name} className="w-5 h-5 rounded-full object-cover" />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
                                  {user.name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                              )}
                              {user.name}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Scheduled */}
            <div className="rounded-xl bg-muted/50 px-4 py-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Scheduled</div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="5.5" y1="2" x2="5.5" y2="4" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="10.5" y1="2" x2="10.5" y2="4" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  <input
                    type="date"
                    value={editingFields.scheduled_date}
                    onChange={(e) => {
                      setEditingFields(prev => prev ? {...prev, scheduled_date: e.target.value} : null);
                      setTimeout(onSave, 0);
                    }}
                    className="bg-transparent border-none outline-none text-[13px] text-muted-foreground focus:text-foreground p-0 w-full min-w-0 [color-scheme:dark]"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="8" y1="8" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <line x1="8" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <input
                    type="time"
                    value={editingFields.scheduled_time}
                    onChange={(e) => {
                      setEditingFields(prev => prev ? {...prev, scheduled_time: e.target.value} : null);
                      setTimeout(onSave, 0);
                    }}
                    className="bg-transparent border-none outline-none text-[13px] text-muted-foreground focus:text-foreground p-0 w-full min-w-0 [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Timer row ── */}
          <div className="rounded-xl bg-muted/50 px-4 py-3 mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                <line x1="8" y1="9" x2="8" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="8" y1="9" x2="10" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="6.5" y1="2.5" x2="9.5" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span className="text-[13px] text-muted-foreground">Time tracked</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] font-medium font-mono text-foreground tracking-wide">
                {formatTime(displaySeconds)}
              </span>
              {activeTimeEntry ? (
                <button
                  onClick={onStopTimer}
                  className="text-xs font-medium px-3.5 py-1 rounded-full bg-red-500/12 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={onStartTimer}
                  className="text-xs font-medium px-3.5 py-1 rounded-full bg-emerald-500/12 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                >
                  {displaySeconds > 0 ? 'Resume' : 'Start'}
                </button>
              )}
            </div>
          </div>

          {/* ── Attachments ── */}
          <div className="mb-5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2.5">Attachments</div>
            <div className="flex gap-2.5 flex-wrap">
              {loadingAttachments ? (
                <span className="text-xs text-muted-foreground">Loading...</span>
              ) : (
                attachments.map((attachment, index) => (
                  <div
                    key={attachment.id}
                    className="relative w-[72px] h-[72px] rounded-lg overflow-hidden border border-border bg-muted/50 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity flex flex-col items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); onViewAttachment(index); }}
                  >
                    {attachment.file_type === 'image' ? (
                      <img src={attachment.url || attachment.file_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <>
                        <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 20 20" fill="none">
                          <path d="M4 2h8l4 4v12H4V2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                          <path d="M12 2v4h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
                        </svg>
                        <span className="text-[9px] text-muted-foreground mt-1 px-1 truncate max-w-full">
                          {attachment.file_name?.split('.').pop()?.toUpperCase() || 'FILE'}
                        </span>
                      </>
                    )}
                  </div>
                ))
              )}
              {/* Upload button */}
              <button
                className="w-[72px] h-[72px] rounded-lg border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploadingAttachment}
              >
                {uploadingAttachment ? (
                  <svg className="w-5 h-5 text-muted-foreground animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 18 18" fill="none">
                    <line x1="9" y1="4" x2="9" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <line x1="4" y1="9" x2="14" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="border-t border-border mb-5" />

          {/* ── Activity / Comments ── */}
          <div>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3.5">Activity</div>

            {loadingComments ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No comments yet</p>
            ) : (
              <div className="space-y-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-2.5">
                    <div className="w-[30px] h-[30px] rounded-full bg-blue-500/15 flex items-center justify-center text-[11px] font-medium text-blue-400 flex-shrink-0">
                      {(comment.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-[13px] font-medium text-foreground">{comment.user_name || 'Unknown'}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(comment.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="text-[13px] text-muted-foreground leading-relaxed bg-muted/50 px-3.5 py-2.5 rounded-r-lg rounded-bl-lg whitespace-pre-wrap">
                        {comment.comment_content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <ScrollBar />
      </ScrollArea>

      {/* ── Comment input — sticky bottom ── */}
      <div className="flex-shrink-0 border-t border-border px-5 py-3 bg-card">
        <div className="flex items-center gap-2.5 bg-muted/50 rounded-xl px-3.5 py-2.5 border border-border/50">
          {/* Hidden file input */}
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={onAttachmentUpload}
          />
          <DebouncedTextarea
            placeholder="Add a comment..."
            rows={1}
            className="resize-none min-h-[24px] flex-1 bg-transparent border-none p-0 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            value={newComment}
            onChange={setNewComment}
            delay={50}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                const value = (e.target as HTMLTextAreaElement).value.trim();
                if (value) {
                  e.preventDefault();
                  setNewComment(value);
                  setTimeout(() => onPostComment(), 0);
                }
              }
            }}
            disabled={postingComment}
          />
          <button
            onClick={onPostComment}
            disabled={postingComment || !newComment.trim()}
            className="flex-shrink-0 p-1 hover:opacity-80 transition-opacity disabled:opacity-30"
          >
            <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
              <path d="M14 2L7 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M14 2l-4.5 12-2-5.5L2 6.5 14 2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
