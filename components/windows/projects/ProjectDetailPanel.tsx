'use client';

import { RefObject, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DebouncedNativeInput, DebouncedTextarea } from '@/components/ui/debounced-input';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';
import { cn } from '@/lib/utils';
import type { Project, User, ProjectFormFields, Comment, Attachment, TimeEntry, PropertyOption, ProjectBin, TaskTemplate } from '@/lib/types';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import type { Template } from '@/components/DynamicCleaningForm';

// ── Reusable inline dropdown panel (matches mobile InlineDropdown) ──
function InlineDropdown({ children, onClose, align = 'left' }: { children: React.ReactNode; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1.5 z-[70] min-w-[200px] max-w-[280px] rounded-xl glass-card bg-white/[0.97] dark:bg-neutral-900/[0.98] border border-white/30 dark:border-white/15`}
    >
      <div className="relative overflow-hidden rounded-xl glass-sheen max-h-[50vh] overflow-y-auto py-1">
        {children}
      </div>
    </div>
  );
}

// ── Green checkmark icon ──
function GreenCheck() {
  return (
    <svg className="w-4 h-4 ml-auto text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

interface ProjectDetailPanelProps {
  project: Project;
  editingFields: ProjectFormFields;
  setEditingFields: (fields: ProjectFormFields | null | ((prev: ProjectFormFields | null) => ProjectFormFields | null)) => void;
  users: User[];
  allProperties?: PropertyOption[];
  savingEdit: boolean;
  onSave: (fields?: ProjectFormFields) => void;
  onDelete: (project: Project) => void;
  onClose: () => void;
  onOpenActivity: () => void;
  onPropertyChange?: (propertyId: string | null, propertyName: string | null) => void;
  // Bins
  bins?: ProjectBin[];
  onBinChange?: (binId: string | null, binName: string | null) => void;
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
  // Template/Checklist (optional — slides in when present)
  template?: Template | null;
  formMetadata?: Record<string, unknown>;
  onSaveForm?: (formData: Record<string, unknown>) => Promise<void>;
  loadingTemplate?: boolean;
  currentUser?: User | null;
  onValidationChange?: (allRequiredFilled: boolean) => void;
  // Template picker (optional — for tasks without a template)
  availableTemplates?: TaskTemplate[];
  onTemplateChange?: (templateId: string | null) => void;
  // Turnover context (optional)
  onShowTurnover?: () => void;
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
  bins = [],
  onBinChange,
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
  template,
  formMetadata,
  onSaveForm,
  loadingTemplate,
  currentUser,
  onValidationChange,
  availableTemplates = [],
  onTemplateChange,
  onShowTurnover,
}: ProjectDetailPanelProps) {
  const { departments } = useDepartments();

  // Checklist slide state
  const [showChecklist, setShowChecklist] = useState(false);
  const hasChecklist = !!template;
  const isAssigned = currentUser ? editingFields.assigned_staff?.includes(currentUser.id) : false;
  const timerNeverStarted = !!template && displaySeconds === 0 && !activeTimeEntry;
  const isChecklistReadOnly = !isAssigned || editingFields.status === 'complete' || editingFields.status === 'contingent' || timerNeverStarted;

  // Auto-status transitions for templated tasks
  const autoSetStatus = useCallback((targetStatus: string) => {
    if (!template || !editingFields) return;
    const updated = { ...editingFields, status: targetStatus };
    setEditingFields(updated);
    onSave(updated);
  }, [template, editingFields, setEditingFields, onSave]);

  const handleTimerStart = useCallback(() => {
    onStartTimer();
    if (template && (editingFields.status === 'not_started' || editingFields.status === 'paused')) {
      autoSetStatus('in_progress');
    }
  }, [onStartTimer, template, editingFields.status, autoSetStatus]);

  const handleTimerStop = useCallback(() => {
    onStopTimer();
    if (template && editingFields.status === 'in_progress') {
      autoSetStatus('paused');
    }
  }, [onStopTimer, template, editingFields.status, autoSetStatus]);

  const handleChecklistInteraction = useCallback(() => {
    if (template && editingFields.status === 'not_started') {
      autoSetStatus('in_progress');
    }
  }, [template, editingFields.status, autoSetStatus]);

  const prevAllFilledRef = useRef(false);
  const handleValidationChange = useCallback((allRequiredFilled: boolean) => {
    const wasAllFilled = prevAllFilledRef.current;
    prevAllFilledRef.current = allRequiredFilled;
    if (!wasAllFilled && allRequiredFilled && template && editingFields.status === 'in_progress') {
      autoSetStatus('complete');
    }
    onValidationChange?.(allRequiredFilled);
  }, [template, editingFields.status, autoSetStatus, onValidationChange]);

  // Picker open states
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [deptIconOpen, setDeptIconOpen] = useState(false);
  const [deptPillOpen, setDeptPillOpen] = useState(false);

  // Template picker state
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  // Search states
  const [propertySearch, setPropertySearch] = useState('');
  const [binSearch, setBinSearch] = useState('');
  const [staffSearch, setStaffSearch] = useState('');

  // Close all pickers helper
  const closeAllPickers = useCallback(() => {
    setStatusOpen(false);
    setPriorityOpen(false);
    setDeptIconOpen(false);
    setDeptPillOpen(false);
    setPropertyOpen(false);
    setBinOpen(false);
    setTemplateOpen(false);
    setStaffOpen(false);
  }, [setStaffOpen]);

  // Current bin name
  const currentBin = bins.find(b => b.id === project.bin_id);

  // Derived data
  const assignedUsers = users.filter(u => editingFields.assigned_staff?.includes(u.id));
  const dept = departments.find(d => d.id === editingFields.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);

  // Filtered lists
  const filteredProperties = useMemo(() => {
    if (!propertySearch.trim()) return allProperties;
    const lower = propertySearch.toLowerCase();
    return allProperties.filter(p => p.name.toLowerCase().includes(lower));
  }, [allProperties, propertySearch]);

  const filteredBins = useMemo(() => {
    if (!binSearch.trim()) return bins;
    const lower = binSearch.toLowerCase();
    return bins.filter(b => b.name.toLowerCase().includes(lower));
  }, [bins, binSearch]);

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return availableTemplates;
    const lower = templateSearch.toLowerCase();
    return availableTemplates.filter(t => t.name.toLowerCase().includes(lower));
  }, [availableTemplates, templateSearch]);

  const currentTemplateName = project.template_name
    || availableTemplates.find(t => t.id === project.template_id)?.name
    || null;

  const filteredUsers = useMemo(() => {
    if (!staffSearch.trim()) return users;
    const lower = staffSearch.toLowerCase();
    return users.filter(u => u.name?.toLowerCase().includes(lower));
  }, [users, staffSearch]);

  // Status config (unified: project + task statuses)
  const statusConfig: Record<string, { bg: string; dot: string; label: string }> = {
    contingent: { bg: 'bg-neutral-400/10 text-white', dot: 'bg-neutral-500', label: 'Contingent' },
    not_started: { bg: 'bg-amber-500/15 text-white', dot: 'bg-amber-400', label: 'Not Started' },
    in_progress: { bg: 'bg-indigo-500/15 text-white', dot: 'bg-indigo-400', label: 'In Progress' },
    paused: { bg: 'bg-neutral-400/15 text-white', dot: 'bg-neutral-400', label: 'Paused' },
    complete: { bg: 'bg-emerald-500/15 text-white', dot: 'bg-emerald-400', label: 'Complete' },
  };

  // Priority config
  const priorityConfig: Record<string, { bg: string; dot: string; label: string }> = {
    low: { bg: 'bg-slate-500/15 text-white', dot: 'bg-slate-400', label: 'Low' },
    medium: { bg: 'bg-blue-500/15 text-white', dot: 'bg-blue-500', label: 'Medium' },
    high: { bg: 'bg-orange-500/15 text-white', dot: 'bg-orange-500', label: 'High' },
    urgent: { bg: 'bg-red-500/15 text-white', dot: 'bg-red-500', label: 'Urgent' },
  };

  const STATUS_OPTIONS = ['not_started', 'in_progress', 'paused', 'complete'];
  const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

  const status = statusConfig[editingFields.status] || statusConfig.not_started;
  const priority = priorityConfig[editingFields.priority] || priorityConfig.medium;

  return (
    <div className="w-full h-full flex flex-col bg-transparent">
      {/* ── Top actions (checklist, activity, delete, close) ── */}
      <div className="flex-shrink-0 flex items-center justify-end gap-0.5 px-3 pt-2">
        {hasChecklist && (
          <button
            onClick={() => setShowChecklist(!showChecklist)}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              showChecklist ? "bg-indigo-500/15 text-indigo-400" : "hover:bg-muted text-muted-foreground"
            )}
            title={showChecklist ? "Back to details" : "View checklist"}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
        )}
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

      {/* ── Scrollable body (detail view / checklist view) ── */}
      <div className="flex-1 min-h-0 relative overflow-hidden">

        {/* ── Checklist slide-over ── */}
        {hasChecklist && (
          <div
            className={cn(
              "absolute inset-0 z-20 bg-background/95 backdrop-blur-sm transition-transform duration-300 ease-in-out overflow-y-auto overlay-scrollbar overscroll-contain",
              showChecklist ? "translate-x-0" : "translate-x-full"
            )}
          >
            <div className="px-6 pb-6 pt-4">
              {/* Checklist header */}
              <div className="flex items-center gap-3 mb-5">
                <button
                  onClick={() => setShowChecklist(false)}
                  className="p-1.5 hover:bg-muted rounded-md transition-colors"
                >
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{template?.name || 'Checklist'}</div>
                  <div className="text-[11px] text-muted-foreground">Template checklist</div>
                </div>
                {isChecklistReadOnly && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {timerNeverStarted ? 'Start timer to unlock' : 'Read only'}
                  </span>
                )}
              </div>

              {/* Action buttons row */}
              <div className="flex items-center gap-2 mb-4">
                {activeTimeEntry ? (
                  <button
                    onClick={handleTimerStop}
                    className="flex-1 text-sm font-medium py-2.5 rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors border border-red-500/20"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleTimerStart}
                    className="flex-1 text-sm font-medium py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors border border-emerald-500/20"
                  >
                    {displaySeconds > 0 ? 'Resume' : 'Start'}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (editingFields.status === 'complete') {
                      const f = { ...editingFields, status: 'paused' }; setEditingFields(f); onSave(f);
                      return;
                    }
                    const fd = formMetadata || {};
                    const hasIncomplete = Object.entries(fd).some(([k, v]) => {
                      if (['property_name', 'template_id', 'template_name'].includes(k)) return false;
                      const val = (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>))
                        ? (v as Record<string, unknown>).value : v;
                      return val === false || val === '' || val === undefined || val === null;
                    });
                    if (hasIncomplete && !confirm('Are you sure you want to complete this task? The checklist has not been completed.')) return;
                    if (activeTimeEntry) onStopTimer();
                    const f = { ...editingFields, status: 'complete' };
                    setEditingFields(f);
                    onSave(f);
                  }}
                  className={cn(
                    "flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors border",
                    editingFields.status === 'complete'
                      ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border-amber-500/20"
                      : "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-blue-500/20"
                  )}
                >
                  {editingFields.status === 'complete' ? 'Reopen' : 'Complete'}
                </button>
              </div>

              {/* Time display */}
              <div className="rounded-xl bg-white/[0.04] backdrop-blur-sm border border-white/10 px-5 py-3 flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="8" y1="9" x2="8" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <line x1="8" y1="9" x2="10" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <line x1="6.5" y1="2.5" x2="9.5" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span className="text-[13px] text-muted-foreground">Time tracked</span>
                </div>
                <span className="text-[15px] font-medium font-mono text-foreground tracking-wide">
                  {formatTime(displaySeconds)}
                </span>
              </div>

              {/* Checklist form */}
              {loadingTemplate ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground">Loading checklist...</p>
                </div>
              ) : template ? (
                <DynamicCleaningForm
                  cleaningId={project.id}
                  propertyName={project.property_name || ''}
                  template={template}
                  formMetadata={formMetadata}
                  onSave={async (formData) => {
                    if (onSaveForm) await onSaveForm(formData);
                  }}
                  readOnly={isChecklistReadOnly}
                  onValidationChange={handleValidationChange}
                  onChecklistInteraction={handleChecklistInteraction}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* ── Detail view ── */}
        <div className={cn(
          "h-full overflow-y-auto overlay-scrollbar overscroll-contain transition-transform duration-300 ease-in-out",
          showChecklist ? "-translate-x-full" : "translate-x-0"
        )}>
        <div className="flex flex-col gap-5 px-6 pb-6 pt-4">

          {/* ── Header: Department icon + Title + Property + Bin ── */}
          <div className="flex items-start gap-3.5">
            {/* Department icon — large, clickable */}
            <div className="relative">
              <button
                onClick={() => { closeAllPickers(); setDeptIconOpen(!deptIconOpen); }}
                className="w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80 glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10"
                style={{ backgroundColor: dept ? 'rgba(133,183,235,0.12)' : 'rgba(255,255,255,0.06)' }}
                title={dept?.name || 'No Department — click to assign'}
              >
                <DeptIcon className="w-5 h-5" style={{ color: dept ? '#85B7EB' : '#6a6a72' }} />
              </button>
              {deptIconOpen && (
                <InlineDropdown onClose={() => setDeptIconOpen(false)}>
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Department</p>
                  <button
                    onClick={() => { const f = {...editingFields, department_id: ''}; setEditingFields(f); onSave(f); setDeptIconOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      !editingFields.department_id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="text-[15px] text-neutral-500">No Department</span>
                    {!editingFields.department_id && <GreenCheck />}
                  </button>
                  {departments.map((d) => {
                    const DIcon2 = getDepartmentIcon(d.icon);
                    return (
                      <button
                        key={d.id}
                        onClick={() => { const f = {...editingFields, department_id: d.id}; setEditingFields(f); onSave(f); setDeptIconOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          editingFields.department_id === d.id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <DIcon2 className="w-4 h-4 text-sky-500" />
                        <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{d.name}</span>
                        {editingFields.department_id === d.id && <GreenCheck />}
                      </button>
                    );
                  })}
                </InlineDropdown>
              )}
            </div>

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
              <div className="relative">
                <button
                  onClick={() => { closeAllPickers(); setPropertyOpen(!propertyOpen); setPropertySearch(''); }}
                  className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                >
                  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 3.375 4.5 8.5 4.5 8.5s4.5-5.125 4.5-8.5A4.5 4.5 0 008 1.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                  </svg>
                  <span className="truncate">{project.property_name || 'No property'}</span>
                  <svg className={`w-3 h-3 opacity-50 transition-transform flex-shrink-0 ${propertyOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {propertyOpen && (
                  <InlineDropdown onClose={() => setPropertyOpen(false)}>
                    <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Property</p>
                    <div className="px-3 pb-2">
                      <input
                        type="text"
                        placeholder="Search properties..."
                        value={propertySearch}
                        onChange={(e) => setPropertySearch(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-neutral-200/60 dark:border-white/10 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-300 dark:focus:border-white/20"
                      />
                    </div>
                    <button
                      onClick={() => { onPropertyChange?.(null, null); setPropertyOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        !project.property_name ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="text-[15px] text-neutral-500 dark:text-neutral-400 italic">No Property</span>
                      {!project.property_name && <GreenCheck />}
                    </button>
                    {filteredProperties.map((prop) => (
                      <button
                        key={prop.id || prop.name}
                        onClick={() => { onPropertyChange?.(prop.id || null, prop.name); setPropertyOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          project.property_name === prop.name ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 3.375 4.5 8.5 4.5 8.5s4.5-5.125 4.5-8.5A4.5 4.5 0 008 1.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                        </svg>
                        <span className="text-[15px] text-neutral-900 dark:text-white flex-1 truncate">{prop.name}</span>
                        {project.property_name === prop.name && <GreenCheck />}
                      </button>
                    ))}
                  </InlineDropdown>
                )}
              </div>

              {/* Bin — clickable to move to another bin */}
              {bins.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => { closeAllPickers(); setBinOpen(!binOpen); setBinSearch(''); }}
                    className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    <span className="truncate">{currentBin?.name || 'No bin'}</span>
                    <svg className={`w-3 h-3 opacity-50 transition-transform flex-shrink-0 ${binOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {binOpen && (
                    <InlineDropdown onClose={() => setBinOpen(false)}>
                      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Bin</p>
                      <div className="px-3 pb-2">
                        <input
                          type="text"
                          placeholder="Search bins..."
                          value={binSearch}
                          onChange={(e) => setBinSearch(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-neutral-200/60 dark:border-white/10 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-300 dark:focus:border-white/20"
                        />
                      </div>
                      <button
                        onClick={() => { onBinChange?.(null, null); setBinOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          !project.bin_id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className="text-[15px] text-neutral-500 dark:text-neutral-400 italic">No Bin</span>
                        {!project.bin_id && <GreenCheck />}
                      </button>
                      {filteredBins.map((bin) => (
                        <button
                          key={bin.id}
                          onClick={() => { onBinChange?.(bin.id, bin.name); setBinOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            project.bin_id === bin.id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                          <span className="text-[15px] text-neutral-900 dark:text-white flex-1 truncate">{bin.name}</span>
                          {project.bin_id === bin.id && <GreenCheck />}
                        </button>
                      ))}
                    </InlineDropdown>
                  )}
                </div>
              )}

              {/* Template — clickable to assign/change a checklist template */}
              {onTemplateChange && availableTemplates.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => { closeAllPickers(); setTemplateOpen(!templateOpen); setTemplateSearch(''); }}
                    className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <span className="truncate">{currentTemplateName || 'No template'}</span>
                    <svg className={`w-3 h-3 opacity-50 transition-transform flex-shrink-0 ${templateOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {templateOpen && (
                    <InlineDropdown onClose={() => setTemplateOpen(false)}>
                      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Template</p>
                      <div className="px-3 pb-2">
                        <input
                          type="text"
                          placeholder="Search templates..."
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-neutral-200/60 dark:border-white/10 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-300 dark:focus:border-white/20"
                        />
                      </div>
                      <button
                        onClick={() => { onTemplateChange(null); setTemplateOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          !project.template_id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className="text-[15px] text-neutral-500 dark:text-neutral-400 italic">No Template</span>
                        {!project.template_id && <GreenCheck />}
                      </button>
                      {filteredTemplates.map((tmpl) => (
                        <button
                          key={tmpl.id}
                          onClick={() => { onTemplateChange(tmpl.id); setTemplateOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            project.template_id === tmpl.id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <span className="text-[15px] text-neutral-900 dark:text-white truncate block">{tmpl.name}</span>
                            {tmpl.department_name && (
                              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{tmpl.department_name}</span>
                            )}
                          </div>
                          {project.template_id === tmpl.id && <GreenCheck />}
                        </button>
                      ))}
                    </InlineDropdown>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Status / Priority / Department pills ── */}
          <div className="flex flex-wrap gap-2">
            {/* Status pill */}
            <div className="relative">
              <button
                onClick={() => { closeAllPickers(); setStatusOpen(!statusOpen); }}
                className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10", status.bg)}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                {status.label}
              </button>
              {statusOpen && (
                <InlineDropdown onClose={() => setStatusOpen(false)}>
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Status</p>
                  {STATUS_OPTIONS.map((key) => {
                    const cfg = statusConfig[key];
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          if (key === editingFields.status) { setStatusOpen(false); return; }
                          if (project.template_id) {
                            const hasBeenWorkedOn = editingFields.status === 'in_progress' || editingFields.status === 'paused' ||
                              (formMetadata && Object.keys(formMetadata).some(
                                k => !['property_name', 'template_id', 'template_name'].includes(k)
                              ));
                            if (key === 'not_started' && hasBeenWorkedOn) {
                              alert('This task has already been started. If progress needs to be delayed, move to "Paused".');
                              return;
                            }
                            if (key === 'complete' && editingFields.status !== 'complete') {
                              const fd = formMetadata || {};
                              const hasIncomplete = Object.entries(fd).some(([k, v]) => {
                                if (['property_name', 'template_id', 'template_name'].includes(k)) return false;
                                const val = (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>))
                                  ? (v as Record<string, unknown>).value : v;
                                return val === false || val === '' || val === undefined || val === null;
                              });
                              if (hasIncomplete && !confirm('Are you sure you want to complete this task? The checklist has not been completed.')) {
                                return;
                              }
                            }
                          }
                          const f = {...editingFields, status: key}; setEditingFields(f); onSave(f); setStatusOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          editingFields.status === key ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                        <span className="text-[15px] text-neutral-900 dark:text-white">{cfg.label}</span>
                        {editingFields.status === key && <GreenCheck />}
                      </button>
                    );
                  })}
                </InlineDropdown>
              )}
            </div>

            {/* Priority pill */}
            <div className="relative">
              <button
                onClick={() => { closeAllPickers(); setPriorityOpen(!priorityOpen); }}
                className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10", priority.bg)}
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M5 0l1.5 3.5L10 4l-2.5 2.5L8 10 5 8l-3 2 .5-3.5L0 4l3.5-.5z" />
                </svg>
                {priority.label} priority
              </button>
              {priorityOpen && (
                <InlineDropdown onClose={() => setPriorityOpen(false)}>
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Priority</p>
                  {PRIORITY_OPTIONS.map((key) => {
                    const cfg = priorityConfig[key];
                    return (
                      <button
                        key={key}
                        onClick={() => { const f = {...editingFields, priority: key}; setEditingFields(f); onSave(f); setPriorityOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          editingFields.priority === key ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                        <span className="text-[15px] text-neutral-900 dark:text-white">{cfg.label}</span>
                        {editingFields.priority === key && <GreenCheck />}
                      </button>
                    );
                  })}
                </InlineDropdown>
              )}
            </div>

            {/* Department pill (only show if set) */}
            {dept && (
              <div className="relative">
                <button
                  onClick={() => { closeAllPickers(); setDeptPillOpen(!deptPillOpen); }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-sky-500/12 text-white transition-opacity hover:opacity-80 glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10"
                >
                  <DeptIcon className="w-3 h-3" />
                  {dept.name}
                </button>
                {deptPillOpen && (
                  <InlineDropdown onClose={() => setDeptPillOpen(false)}>
                    <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Department</p>
                    <button
                      onClick={() => { const f = {...editingFields, department_id: ''}; setEditingFields(f); onSave(f); setDeptPillOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        !editingFields.department_id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="text-[15px] text-neutral-500">No Department</span>
                      {!editingFields.department_id && <GreenCheck />}
                    </button>
                    {departments.map((d) => {
                      const DIcon2 = getDepartmentIcon(d.icon);
                      return (
                        <button
                          key={d.id}
                          onClick={() => { const f = {...editingFields, department_id: d.id}; setEditingFields(f); onSave(f); setDeptPillOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            editingFields.department_id === d.id ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                          }`}
                        >
                          <DIcon2 className="w-4 h-4 text-sky-500" />
                          <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{d.name}</span>
                          {editingFields.department_id === d.id && <GreenCheck />}
                        </button>
                      );
                    })}
                  </InlineDropdown>
                )}
              </div>
            )}
          </div>

          {/* ── Description card ── */}
          <div className="rounded-xl bg-white/[0.04] backdrop-blur-sm border border-white/10 px-5 py-4 flex flex-col gap-2">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Description</div>
            <RichTextEditor
              content={editingFields.description}
              onChange={(json) => setEditingFields(prev => prev ? {...prev, description: json} : null)}
              onBlur={onSave}
              placeholder="Add a description or checklist..."
            />
          </div>

          {/* ── Assigned + Scheduled grid ── */}
          <div className="grid grid-cols-2 gap-3.5 relative z-10">
            {/* Assigned to */}
            <div className="rounded-xl bg-white/[0.04] backdrop-blur-sm border border-white/10 px-5 py-4 flex flex-col gap-3">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Assigned to</div>
              <div className="relative">
                <button
                  onClick={() => { closeAllPickers(); setStaffOpen(!staffOpen); setStaffSearch(''); }}
                  className="flex items-center gap-1 w-full hover:opacity-80 transition-opacity flex-wrap"
                >
                  {assignedUsers.length > 0 ? (
                    <>
                      <div className="flex items-center -space-x-1.5">
                        {assignedUsers.map((u) => (
                          <div key={u.id} className="relative group">
                            {u.avatar ? (
                              <img
                                src={u.avatar}
                                alt={u.name}
                                className="w-7 h-7 rounded-full object-cover ring-2 ring-background flex-shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-blue-500/15 flex items-center justify-center text-[10px] font-medium text-blue-400 flex-shrink-0 ring-2 ring-background">
                                {u.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-popover border border-border text-[11px] text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-md">
                              {u.name}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Plus icon to add more */}
                      <div className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/20 flex items-center justify-center flex-shrink-0 ml-1">
                        <svg className="w-3 h-3 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
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
                {staffOpen && (
                  <InlineDropdown onClose={() => setStaffOpen(false)}>
                    <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Assign Staff</p>
                    <div className="px-3 pb-2">
                      <input
                        type="text"
                        placeholder="Search staff..."
                        value={staffSearch}
                        onChange={(e) => setStaffSearch(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-neutral-200/60 dark:border-white/10 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-300 dark:focus:border-white/20"
                      />
                    </div>
                    {editingFields.assigned_staff?.length > 0 && (
                      <button
                        onClick={() => {
                          const f = {...editingFields, assigned_staff: []};
                          setEditingFields(f);
                          onSave(f);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                      >
                        <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-[15px] text-neutral-500 dark:text-neutral-400">Clear all</span>
                      </button>
                    )}
                    {filteredUsers.map((user) => {
                      const isAssigned = editingFields.assigned_staff?.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          onClick={() => {
                            const current = editingFields.assigned_staff || [];
                            const updated = isAssigned
                              ? current.filter(id => id !== user.id)
                              : [...current, user.id];
                            const f = {...editingFields, assigned_staff: updated};
                            setEditingFields(f);
                            onSave(f);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isAssigned ? 'bg-white/40 dark:bg-white/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                          }`}
                        >
                          {user.avatar ? (
                            <img src={user.avatar} alt={user.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-blue-500/15 flex items-center justify-center text-[10px] font-medium text-blue-400 flex-shrink-0">
                              {user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{user.name}</span>
                          {isAssigned && <GreenCheck />}
                        </button>
                      );
                    })}
                  </InlineDropdown>
                )}
              </div>
            </div>

            {/* Scheduled */}
            <div className="rounded-xl bg-white/[0.04] backdrop-blur-sm border border-white/10 px-5 py-4 flex flex-col gap-3">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Scheduled</div>
              <div className="flex flex-col gap-3">
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
                      const f = {...editingFields, scheduled_date: e.target.value};
                      setEditingFields(f);
                      onSave(f);
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
                      const f = {...editingFields, scheduled_time: e.target.value};
                      setEditingFields(f);
                      onSave(f);
                    }}
                    className="bg-transparent border-none outline-none text-[13px] text-muted-foreground focus:text-foreground p-0 w-full min-w-0 [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Timer row (only shown here for non-templated tasks; templated tasks show timer on checklist side) ── */}
          {!hasChecklist && (
            <div className="rounded-xl bg-white/[0.04] backdrop-blur-sm border border-white/10 px-5 py-4 flex items-center justify-between">
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
                    className="text-xs font-medium px-3.5 py-1.5 rounded-full bg-red-500/12 text-white hover:opacity-80 transition-opacity glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleTimerStart}
                    className="text-xs font-medium px-3.5 py-1.5 rounded-full bg-emerald-500/12 text-white hover:opacity-80 transition-opacity glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10"
                  >
                    {displaySeconds > 0 ? 'Resume' : 'Start'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Attachments ── */}
          <div className="flex flex-col gap-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Attachments</div>
            <div className="flex gap-2.5 flex-wrap">
              {loadingAttachments ? (
                <span className="text-xs text-muted-foreground">Loading...</span>
              ) : (
                attachments.map((attachment, index) => (
                  <div
                    key={attachment.id}
                    className="relative w-[72px] h-[72px] rounded-lg overflow-hidden border border-white/10 bg-white/[0.04] flex-shrink-0 cursor-pointer hover:bg-white/[0.08] transition-all flex flex-col items-center justify-center"
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
                        <span className="text-[9px] text-muted-foreground pt-1 px-1 truncate max-w-full">
                          {attachment.file_name?.split('.').pop()?.toUpperCase() || 'FILE'}
                        </span>
                      </>
                    )}
                  </div>
                ))
              )}
              {/* Upload button */}
              <button
                className="w-[72px] h-[72px] rounded-lg border border-dashed border-white/10 flex items-center justify-center cursor-pointer hover:bg-white/[0.06] transition-all"
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
          <div className="border-t border-white/10" />

          {/* ── Activity / Comments ── */}
          <div className="flex flex-col gap-4">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Activity</div>

            {loadingComments ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No comments yet</p>
            ) : (
              <div className="flex flex-col gap-5">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <div className="w-[30px] h-[30px] rounded-full bg-blue-500/15 flex items-center justify-center text-[11px] font-medium text-blue-400 flex-shrink-0">
                      {(comment.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 pb-1">
                        <span className="text-[13px] font-medium text-foreground">{comment.user_name || 'Unknown'}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(comment.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="text-[13px] text-muted-foreground leading-relaxed bg-white/[0.04] border border-white/10 px-3.5 py-2.5 rounded-r-lg rounded-bl-lg whitespace-pre-wrap">
                        {comment.comment_content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* ── Comment input — sticky bottom (hidden when checklist is open) ── */}
      <div className="flex-shrink-0 border-t border-white/10 px-6 py-3.5 bg-transparent">
        <div className="flex items-center gap-2.5 bg-white/[0.04] backdrop-blur-sm rounded-xl px-4 py-3 border border-white/10">
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
            className="resize-none min-h-[24px] flex-1 bg-transparent dark:bg-transparent border-none p-0 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
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

      {/* ── Associated Turnover footer (when linked to a reservation) ── */}
      {onShowTurnover && !showChecklist && (
        <div className="flex-shrink-0 border-t border-white/10 px-6 py-3">
          <button
            onClick={onShowTurnover}
            className="w-full flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Associated Turnover
          </button>
        </div>
      )}
    </div>
  );
}
