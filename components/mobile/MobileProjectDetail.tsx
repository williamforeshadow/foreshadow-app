'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import type { Project, User, ProjectFormFields, Comment, Attachment, PropertyOption, ProjectBin, TiptapJSON, TaskTemplate } from '@/lib/types';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import type { Template } from '@/components/DynamicCleaningForm';

// ============================================================================
// Types
// ============================================================================

interface MobileProjectDetailProps {
  project: Project;
  users: User[];
  onClose: () => void;
  onSave: (projectId: string, fields: ProjectFormFields) => Promise<Project | null>;
  onDelete?: (project: Project) => void;
  allProperties?: PropertyOption[];
  onPropertyChange?: (propertyId: string | null, propertyName: string | null) => void;
  bins?: ProjectBin[];
  onBinChange?: (binId: string | null, binName: string | null) => void;
  template?: Template | null;
  formMetadata?: Record<string, unknown>;
  onSaveForm?: (formData: Record<string, unknown>) => Promise<void>;
  loadingTemplate?: boolean;
  availableTemplates?: TaskTemplate[];
  onTemplateChange?: (templateId: string | null) => void;
}

// ============================================================================
// Status / Priority Configs
// ============================================================================

const STATUS_CONFIG: Record<string, { bg: string; dot: string; label: string }> = {
  not_started: { bg: 'bg-amber-500/15 text-white', dot: 'bg-amber-500', label: 'Not Started' },
  in_progress: { bg: 'bg-indigo-500/15 text-white', dot: 'bg-indigo-500', label: 'In Progress' },
  paused: { bg: 'bg-neutral-400/15 text-white', dot: 'bg-neutral-400', label: 'Paused' },
  complete: { bg: 'bg-emerald-500/15 text-white', dot: 'bg-emerald-500', label: 'Complete' },
};

const PRIORITY_CONFIG: Record<string, { bg: string; label: string }> = {
  low: { bg: 'bg-slate-500/15 text-white', label: 'Low' },
  medium: { bg: 'bg-blue-500/15 text-white', label: 'Medium' },
  high: { bg: 'bg-orange-500/15 text-white', label: 'High' },
  urgent: { bg: 'bg-red-500/15 text-white', label: 'Urgent' },
};

const STATUS_OPTIONS = ['not_started', 'in_progress', 'paused', 'complete'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

// ============================================================================
// Main Component
// ============================================================================

export default function MobileProjectDetail({
  project,
  users,
  onClose,
  onSave,
  onDelete,
  allProperties = [],
  onPropertyChange,
  bins = [],
  onBinChange,
  template,
  formMetadata,
  onSaveForm,
  loadingTemplate,
  availableTemplates = [],
  onTemplateChange,
}: MobileProjectDetailProps) {
  const { user: currentUser } = useAuth();
  const { departments } = useDepartments();

  // Local editing fields
  const [fields, setFields] = useState<ProjectFormFields>({
    title: project.title,
    description: (project.description as TiptapJSON | null) || null,
    status: project.status,
    priority: project.priority,
    assigned_staff: project.project_assignments?.map(a => a.user_id) || [],
    department_id: project.department_id || '',
    scheduled_date: project.scheduled_date || '',
    scheduled_time: project.scheduled_time || '',
  });

  // Sync fields when project changes (e.g. parent swaps to different task)
  useEffect(() => {
    setFields({
      title: project.title,
      description: (project.description as TiptapJSON | null) || null,
      status: project.status,
      priority: project.priority,
      assigned_staff: project.project_assignments?.map(a => a.user_id) || [],
      department_id: project.department_id || '',
      scheduled_date: project.scheduled_date || '',
      scheduled_time: project.scheduled_time || '',
    });
  }, [project.id]);

  // UI state
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);
  const [showBinPicker, setShowBinPicker] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');
  const [binSearch, setBinSearch] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [activeSection, setActiveSection] = useState<'details' | 'checklist' | 'comments' | 'attachments'>('details');
  const [saving, setSaving] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  // Hooks for comments, attachments, time tracking
  const commentsHook = useProjectComments({ currentUser: currentUser as User | null });
  const attachmentsHook = useProjectAttachments({ currentUser: currentUser as User | null });
  const timeTrackingHook = useProjectTimeTracking({ currentUser: currentUser as User | null });

  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Load data on mount
  useEffect(() => {
    commentsHook.fetchProjectComments(project.id, 'task');
    attachmentsHook.fetchProjectAttachments(project.id, 'task');
    timeTrackingHook.fetchProjectTimeEntries(project.id, 'task');
  }, [project.id]);

  // Auto-save helper
  const autoSave = useCallback(async (updatedFields: ProjectFormFields) => {
    setSaving(true);
    await onSave(project.id, updatedFields);
    setSaving(false);
  }, [project.id, onSave]);

  // Field update + auto-save
  const updateField = useCallback((key: keyof ProjectFormFields, value: string | string[]) => {
    setFields(prev => {
      const updated = { ...prev, [key]: value };
      autoSave(updated);
      return updated;
    });
  }, [autoSave]);

  // Derived data
  const assignedUsers = users.filter(u => fields.assigned_staff?.includes(u.id));
  const dept = departments.find(d => d.id === fields.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);
  const status = STATUS_CONFIG[fields.status] || STATUS_CONFIG.not_started;
  const priority = PRIORITY_CONFIG[fields.priority] || PRIORITY_CONFIG.medium;
  const currentBin = bins.find(b => b.id === project.bin_id);

  const hasChecklist = !!template;
  const isAssigned = currentUser ? fields.assigned_staff?.includes(currentUser.id) : false;
  const isChecklistReadOnly = !isAssigned || fields.status === 'contingent';

  // Refs for fresh values in effects/callbacks (avoids stale closures)
  const activeTimeEntryRef = useRef(timeTrackingHook.activeTimeEntry);
  activeTimeEntryRef.current = timeTrackingHook.activeTimeEntry;
  const displaySecondsRef = useRef(timeTrackingHook.displaySeconds);
  displaySecondsRef.current = timeTrackingHook.displaySeconds;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // Auto-stop/start timer when status changes (covers all change paths)
  useEffect(() => {
    if (activeTimeEntryRef.current && fields.status !== 'in_progress') {
      timeTrackingHook.stopProjectTimer();
    }
    if (!activeTimeEntryRef.current && fields.status === 'in_progress' && displaySecondsRef.current > 0) {
      timeTrackingHook.startProjectTimer(project.id, 'task');
    }
  }, [fields.status]);

  // Auto-status transitions for templated tasks
  const autoSetStatus = useCallback((targetStatus: string) => {
    if (!template) return;
    setFields(prev => {
      const updated = { ...prev, status: targetStatus };
      autoSave(updated);
      return updated;
    });
  }, [template, autoSave]);

  const handleTimerStart = useCallback(() => {
    timeTrackingHook.startProjectTimer(project.id, 'task');
    const status = fieldsRef.current?.status;
    if (template && (status === 'not_started' || status === 'paused')) {
      autoSetStatus('in_progress');
    }
  }, [timeTrackingHook, project.id, template, autoSetStatus]);

  const handleTimerStop = useCallback(() => {
    timeTrackingHook.stopProjectTimer();
    if (template && fieldsRef.current?.status === 'in_progress') {
      autoSetStatus('paused');
    }
  }, [timeTrackingHook, template, autoSetStatus]);

  const handleChecklistInteraction = useCallback(() => {
    if (template && fieldsRef.current?.status === 'not_started') {
      autoSetStatus('in_progress');
    }
  }, [template, autoSetStatus]);

  const prevAllFilledRef = useRef(false);
  const validationReadyRef = useRef(false);

  useEffect(() => {
    validationReadyRef.current = false;
    prevAllFilledRef.current = false;
    const timer = setTimeout(() => { validationReadyRef.current = true; }, 500);
    return () => clearTimeout(timer);
  }, [project.id]);

  const handleValidationChange = useCallback((allRequiredFilled: boolean) => {
    const wasAllFilled = prevAllFilledRef.current;
    prevAllFilledRef.current = allRequiredFilled;
    if (!validationReadyRef.current) return;
    if (!wasAllFilled && allRequiredFilled && template && fieldsRef.current?.status === 'in_progress') {
      autoSetStatus('complete');
    }
  }, [template, autoSetStatus]);

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return availableTemplates;
    const lower = templateSearch.toLowerCase();
    return availableTemplates.filter(t => t.name.toLowerCase().includes(lower));
  }, [availableTemplates, templateSearch]);

  const currentTemplateName = project.template_name
    || availableTemplates.find(t => t.id === project.template_id)?.name
    || null;

  // Post comment
  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    await commentsHook.postProjectComment(project.id, newComment.trim(), 'task');
    setNewComment('');
  };

  // Upload attachment
  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    attachmentsHook.handleAttachmentUpload(e, project.id, 'task');
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-white dark:bg-neutral-950 flex flex-col"
      style={{ height: '100dvh' }}
    >
      {/* ── Header ── */}
      <div className="shrink-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 safe-area-top">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-neutral-400">Saving...</span>
            )}
            {onDelete && (
              <button
                onClick={() => {
                  if (confirm(`Delete "${project.title}"?`)) {
                    onDelete(project);
                    onClose();
                  }
                }}
                className="p-2 text-red-400 hover:text-red-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Department icon + Title */}
        <div className="flex items-start gap-3 px-4 pb-3">
          <div className="relative shrink-0">
            <button
              onClick={() => { setShowDeptPicker(!showDeptPicker); setShowStatusPicker(false); setShowPriorityPicker(false); setShowPropertyPicker(false); setShowBinPicker(false); }}
              className="w-10 h-10 rounded-xl flex items-center justify-center glass-card glass-sheen relative overflow-hidden bg-sky-500/10 dark:bg-sky-500/15 border border-white/20 dark:border-white/10"
            >
              <DeptIcon className="w-5 h-5 text-white" />
            </button>
            {showDeptPicker && !dept && (
              <InlineDropdown onClose={() => setShowDeptPicker(false)}>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Department</p>
                <button
                  onClick={() => { updateField('department_id', ''); setShowDeptPicker(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    !fields.department_id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                  }`}
                >
                  <span className="text-[15px] text-neutral-500">No Department</span>
                  {!fields.department_id && (
                    <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                {departments.map((d) => {
                  const DIcon2 = getDepartmentIcon(d.icon);
                  return (
                    <button
                      key={d.id}
                      onClick={() => { updateField('department_id', d.id); setShowDeptPicker(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        fields.department_id === d.id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                      }`}
                    >
                      <DIcon2 className="w-4 h-4 text-sky-500" />
                      <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{d.name}</span>
                      {fields.department_id === d.id && (
                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </InlineDropdown>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={fields.title}
              onChange={(e) => setFields(prev => ({ ...prev, title: e.target.value }))}
              onBlur={() => autoSave(fields)}
              placeholder="Untitled Task"
              className="text-lg font-semibold bg-transparent border-none outline-none w-full text-neutral-900 dark:text-white placeholder:text-neutral-400"
            />
            <div className="relative">
              <button
                onClick={() => { setShowPropertyPicker(!showPropertyPicker); setShowBinPicker(false); }}
                className="flex items-center gap-1.5 mt-0.5 group"
              >
                <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 3.375 4.5 8.5 4.5 8.5s4.5-5.125 4.5-8.5A4.5 4.5 0 008 1.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                </svg>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {project.property_name || 'No property'}
                </span>
                <svg className={`w-3 h-3 text-neutral-300 dark:text-neutral-600 transition-transform ${showPropertyPicker ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPropertyPicker && (
                <InlineDropdown onClose={() => { setShowPropertyPicker(false); setPropertySearch(''); }}>
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
                    onClick={() => { onPropertyChange?.(null, null); setShowPropertyPicker(false); setPropertySearch(''); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      !project.property_name ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                    }`}
                  >
                    <span className="text-[15px] text-neutral-500 italic">No Property</span>
                    {!project.property_name && (
                      <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {allProperties
                    .filter(prop => !propertySearch.trim() || prop.name.toLowerCase().includes(propertySearch.toLowerCase()))
                    .map((prop) => (
                    <button
                      key={prop.id || prop.name}
                      onClick={() => { onPropertyChange?.(prop.id || null, prop.name); setShowPropertyPicker(false); setPropertySearch(''); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        project.property_name === prop.name ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                      }`}
                    >
                      <svg className="w-4 h-4 text-neutral-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 3.375 4.5 8.5 4.5 8.5s4.5-5.125 4.5-8.5A4.5 4.5 0 008 1.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                      </svg>
                      <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{prop.name}</span>
                      {project.property_name === prop.name && (
                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </InlineDropdown>
              )}
            </div>
            {bins.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setShowBinPicker(!showBinPicker); setShowPropertyPicker(false); setShowTemplatePicker(false); }}
                  className="flex items-center gap-1.5 mt-0.5 group"
                >
                  <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                    {currentBin?.name || 'No bin'}
                  </span>
                  <svg className={`w-3 h-3 text-neutral-300 dark:text-neutral-600 transition-transform ${showBinPicker ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showBinPicker && (
                  <InlineDropdown onClose={() => { setShowBinPicker(false); setBinSearch(''); }}>
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
                      onClick={() => { onBinChange?.(null, null); setShowBinPicker(false); setBinSearch(''); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        !project.bin_id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                      }`}
                    >
                      <span className="text-[15px] text-neutral-500 italic">No Bin</span>
                      {!project.bin_id && (
                        <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    {bins
                      .filter(bin => !binSearch.trim() || bin.name.toLowerCase().includes(binSearch.toLowerCase()))
                      .map((bin) => (
                      <button
                        key={bin.id}
                        onClick={() => { onBinChange?.(bin.id, bin.name); setShowBinPicker(false); setBinSearch(''); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          project.bin_id === bin.id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                        }`}
                      >
                        <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                        <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{bin.name}</span>
                        {project.bin_id === bin.id && (
                          <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </InlineDropdown>
                )}
              </div>
            )}
            {onTemplateChange && availableTemplates.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setShowTemplatePicker(!showTemplatePicker); setShowPropertyPicker(false); setShowBinPicker(false); setTemplateSearch(''); }}
                  className="flex items-center gap-1.5 mt-0.5 group"
                >
                  <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                    {currentTemplateName || 'No template'}
                  </span>
                  <svg className={`w-3 h-3 text-neutral-300 dark:text-neutral-600 transition-transform ${showTemplatePicker ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTemplatePicker && (
                  <InlineDropdown onClose={() => { setShowTemplatePicker(false); setTemplateSearch(''); }}>
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
                      onClick={() => { onTemplateChange(null); setShowTemplatePicker(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        !project.template_id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                      }`}
                    >
                      <span className="text-[15px] text-neutral-500 italic">No Template</span>
                      {!project.template_id && (
                        <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    {filteredTemplates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => { onTemplateChange(tmpl.id); setShowTemplatePicker(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          project.template_id === tmpl.id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                        }`}
                      >
                        <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{tmpl.name}</span>
                        {project.template_id === tmpl.id && (
                          <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </InlineDropdown>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status + Priority + Department pills */}
        <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
          <div className="relative">
            <button
              onClick={() => { setShowStatusPicker(!showStatusPicker); setShowPriorityPicker(false); setShowDeptPicker(false); }}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-full glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10 active:opacity-70 transition-opacity ${status.bg}`}
            >
              <span className={`w-2 h-2 rounded-full ${status.dot}`} />
              {status.label}
            </button>
            {showStatusPicker && (
              <InlineDropdown onClose={() => setShowStatusPicker(false)}>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Status</p>
                {STATUS_OPTIONS.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        if (s === fields.status) { setShowStatusPicker(false); return; }
                        if (project.template_id) {
                          const hasBeenWorkedOn = fields.status === 'in_progress' || fields.status === 'paused' ||
                            (formMetadata && Object.keys(formMetadata).some(
                              k => !['property_name', 'template_id', 'template_name'].includes(k)
                            ));
                          if (s === 'not_started' && hasBeenWorkedOn) {
                            alert('This task has already been started. If progress needs to be delayed, move to "Paused".');
                            return;
                          }
                          if (s === 'complete' && fields.status !== 'complete') {
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
                        updateField('status', s); setShowStatusPicker(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        fields.status === s ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                      <span className="text-[15px] text-neutral-900 dark:text-white">{cfg.label}</span>
                      {fields.status === s && (
                        <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </InlineDropdown>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => { setShowPriorityPicker(!showPriorityPicker); setShowStatusPicker(false); setShowDeptPicker(false); }}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-full glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10 active:opacity-70 transition-opacity ${priority.bg}`}
            >
              {priority.label} priority
            </button>
            {showPriorityPicker && (
              <InlineDropdown onClose={() => setShowPriorityPicker(false)}>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Priority</p>
                {PRIORITY_OPTIONS.map((p) => {
                  const cfg = PRIORITY_CONFIG[p];
                  const dotColor = cfg.bg.includes('red') ? 'bg-red-500' : cfg.bg.includes('orange') ? 'bg-orange-500' : cfg.bg.includes('blue') ? 'bg-blue-500' : 'bg-slate-400';
                  return (
                    <button
                      key={p}
                      onClick={() => { updateField('priority', p); setShowPriorityPicker(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        fields.priority === p ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                      }`}
                    >
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor}`} />
                      <span className="text-[15px] text-neutral-900 dark:text-white">{cfg.label}</span>
                      {fields.priority === p && (
                        <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </InlineDropdown>
            )}
          </div>
          {dept && (
            <div className="relative">
              <button
                onClick={() => { setShowDeptPicker(!showDeptPicker); setShowStatusPicker(false); setShowPriorityPicker(false); }}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-full glass-card glass-sheen relative overflow-hidden border border-white/20 dark:border-white/10 bg-sky-500/10 text-white active:opacity-70 transition-opacity"
              >
                <DeptIcon className="w-3 h-3" />
                {dept.name}
              </button>
              {showDeptPicker && (
                <InlineDropdown onClose={() => setShowDeptPicker(false)}>
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-2.5 pb-1.5">Department</p>
                  <button
                    onClick={() => { updateField('department_id', ''); setShowDeptPicker(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      !fields.department_id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                    }`}
                  >
                    <span className="text-[15px] text-neutral-500">No Department</span>
                    {!fields.department_id && (
                      <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {departments.map((d) => {
                    const DIcon2 = getDepartmentIcon(d.icon);
                    return (
                      <button
                        key={d.id}
                        onClick={() => { updateField('department_id', d.id); setShowDeptPicker(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          fields.department_id === d.id ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                        }`}
                      >
                        <DIcon2 className="w-4 h-4 text-sky-500" />
                        <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{d.name}</span>
                        {fields.department_id === d.id && (
                          <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </InlineDropdown>
              )}
            </div>
          )}
        </div>

        {/* Timer widget */}
        <div className="flex items-center gap-2.5 px-4 pb-3">
          <button
            onClick={() => {
              if (timeTrackingHook.activeTimeEntry) {
                handleTimerStop();
              } else {
                handleTimerStart();
              }
            }}
            disabled={!isAssigned}
            className={`inline-flex items-center gap-2 text-xs font-medium pl-2 pr-3 py-1.5 rounded-full transition-colors border ${
              !isAssigned
                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 border-neutral-300 dark:border-neutral-700 cursor-not-allowed'
                : timeTrackingHook.activeTimeEntry
                  ? 'bg-red-500/12 text-red-400 border-red-500/20 active:opacity-70'
                  : 'bg-emerald-500/12 text-emerald-400 border-emerald-500/20 active:opacity-70'
            }`}
          >
            {timeTrackingHook.activeTimeEntry ? (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                <rect x="1" y="1" width="4" height="10" rx="1" />
                <rect x="7" y="1" width="4" height="10" rx="1" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 1.5a.5.5 0 0 1 .75-.43l8 4.5a.5.5 0 0 1 0 .86l-8 4.5A.5.5 0 0 1 2 10.5v-9z" />
              </svg>
            )}
            <span className="font-mono text-[13px] tracking-wide">{timeTrackingHook.formatTime(timeTrackingHook.displaySeconds)}</span>
          </button>
          {timeTrackingHook.activeTimeEntry && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex border-t border-neutral-100 dark:border-neutral-800">
          {(['details', ...(hasChecklist || loadingTemplate ? ['checklist'] : []), 'comments', 'attachments'] as const).map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section as typeof activeSection)}
              className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors relative ${
                activeSection === section
                  ? 'text-neutral-900 dark:text-white'
                  : 'text-neutral-400'
              }`}
            >
              {section === 'details' && 'Details'}
              {section === 'checklist' && 'Checklist'}
              {section === 'comments' && `Comments${commentsHook.projectComments.length > 0 ? ` (${commentsHook.projectComments.length})` : ''}`}
              {section === 'attachments' && `Files${attachmentsHook.projectAttachments.length > 0 ? ` (${attachmentsHook.projectAttachments.length})` : ''}`}
              {activeSection === section && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-neutral-900 dark:bg-white rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable Body + Comment Input ── */}
      {/* When on the comments tab, the input bar sits below the scroll area.
          We wrap both in a flex-1 container so they share the remaining height. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain hide-scrollbar safe-area-bottom"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
        {/* Details Section */}
        {activeSection === 'details' && (
          <div className="px-5 pt-5 pb-6 flex flex-col gap-5">
            {/* Description & Checklists */}
            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-5 py-4">
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Description</p>
              <RichTextEditor
                content={fields.description}
                onChange={(json) => setFields(prev => ({ ...prev, description: json }))}
                onBlur={() => autoSave(fields)}
                placeholder="Add a description or checklist..."
              />
            </div>

            {/* Assigned + Schedule — side by side */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* Assigned Staff */}
              <div className="relative rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-5 py-4">
                <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Assigned to</p>
                <button
                  onClick={() => setShowStaffPicker(!showStaffPicker)}
                  className="flex items-center gap-2 w-full"
                >
                  {assignedUsers.length > 0 ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="flex -space-x-1.5">
                        {assignedUsers.map((u) => (
                          <UserAvatar key={u.id} src={u.avatar} name={u.name} size="sm" className="ring-2 ring-white dark:ring-neutral-900" />
                        ))}
                      </div>
                      <div className="w-6 h-6 rounded-full border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex items-center justify-center ml-0.5">
                        <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <span className="text-xs text-neutral-400">Tap to assign</span>
                    </div>
                  )}
                </button>
                {showStaffPicker && (
                  <InlineDropdown onClose={() => { setShowStaffPicker(false); setStaffSearch(''); }} align="left">
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
                    {fields.assigned_staff.length > 0 && (
                      <button
                        onClick={() => { updateField('assigned_staff', []); setShowStaffPicker(false); setStaffSearch(''); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-neutral-500 active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-[15px]">Clear all</span>
                      </button>
                    )}
                    {users
                      .filter(user => !staffSearch.trim() || user.name.toLowerCase().includes(staffSearch.toLowerCase()))
                      .map((user) => {
                      const isAssigned = fields.assigned_staff?.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          onClick={() => {
                            const updated = isAssigned
                              ? fields.assigned_staff.filter(id => id !== user.id)
                              : [...fields.assigned_staff, user.id];
                            updateField('assigned_staff', updated);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isAssigned ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                          }`}
                        >
                          <UserAvatar src={user.avatar} name={user.name} size="sm" />
                          <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{user.name}</span>
                          {isAssigned && (
                            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </InlineDropdown>
                )}
              </div>

              {/* Schedule */}
              <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-5 py-4">
                <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Schedule</p>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <input
                      type="date"
                      value={fields.scheduled_date}
                      onChange={(e) => updateField('scheduled_date', e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-[13px] text-neutral-900 dark:text-neutral-100 min-w-0"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <input
                      type="time"
                      value={fields.scheduled_time}
                      onChange={(e) => updateField('scheduled_time', e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-[13px] text-neutral-900 dark:text-neutral-100 min-w-0"
                    />
                  </div>
                </div>
              </div>
            </div>


            {/* Bottom padding */}
            <div className="h-4" />
          </div>
        )}

        {/* Checklist Section */}
        {activeSection === 'checklist' && (
          <div className="px-5 pt-5 pb-6">
            {/* Action buttons row */}
            <div className="flex items-center gap-2 mb-4">
              {timeTrackingHook.activeTimeEntry ? (
                <button
                  onClick={handleTimerStop}
                  className="flex-1 text-sm font-medium py-2.5 rounded-xl bg-red-500/15 text-red-400 active:opacity-70 transition-opacity border border-red-500/20"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleTimerStart}
                  disabled={!isAssigned}
                  className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-opacity border ${
                    isAssigned
                      ? 'bg-emerald-500/15 text-emerald-400 active:opacity-70 border-emerald-500/20'
                      : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 border-neutral-300 dark:border-neutral-700 cursor-not-allowed'
                  }`}
                >
                  {timeTrackingHook.displaySeconds > 0 ? 'Resume' : 'Start'}
                </button>
              )}
              <button
                onClick={() => {
                  if (fields.status === 'complete') {
                    setFields(prev => {
                      const updated = { ...prev, status: 'paused' };
                      autoSave(updated);
                      return updated;
                    });
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
                  if (timeTrackingHook.activeTimeEntry) timeTrackingHook.stopProjectTimer();
                  setFields(prev => {
                    const updated = { ...prev, status: 'complete' };
                    autoSave(updated);
                    return updated;
                  });
                }}
                className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-opacity border ${
                  fields.status === 'complete'
                    ? 'bg-amber-500/15 text-amber-400 active:opacity-70 border-amber-500/20'
                    : 'bg-blue-500/15 text-blue-400 active:opacity-70 border-blue-500/20'
                }`}
              >
                {fields.status === 'complete' ? 'Reopen' : 'Complete'}
              </button>
            </div>

            {/* Time display */}
            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-5 py-3 flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Time tracked</span>
              </div>
              <span className="text-base font-medium font-mono text-neutral-900 dark:text-white">
                {timeTrackingHook.formatTime(timeTrackingHook.displaySeconds)}
              </span>
            </div>

            {loadingTemplate ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
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
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium">No checklist configured</p>
              </div>
            )}
          </div>
        )}

        {/* Comments Section */}
        {activeSection === 'comments' && (
          <div className="flex flex-col">
            <div className="p-4 space-y-4">
              {commentsHook.loadingComments ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : commentsHook.projectComments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                  <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-sm font-medium">No comments yet</p>
                  <p className="text-xs mt-1">Start the conversation below</p>
                </div>
              ) : (
                commentsHook.projectComments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-medium text-blue-500 shrink-0">
                      {(comment.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium text-neutral-900 dark:text-white">{comment.user_name || 'Unknown'}</span>
                        <span className="text-[11px] text-neutral-400">
                          {new Date(comment.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="text-sm text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-3 py-2 rounded-r-xl rounded-bl-xl whitespace-pre-wrap">
                        {comment.comment_content}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div className="h-4" />
            </div>
          </div>
        )}

        {/* Attachments Section */}
        {activeSection === 'attachments' && (
          <div className="p-4 space-y-4">
            {attachmentsHook.loadingAttachments ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Upload button */}
                <div>
                  <input
                    ref={attachmentsHook.attachmentInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx"
                    className="hidden"
                    onChange={handleAttachmentUpload}
                  />
                  <button
                    onClick={() => attachmentsHook.attachmentInputRef.current?.click()}
                    disabled={attachmentsHook.uploadingAttachment}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors"
                  >
                    {attachmentsHook.uploadingAttachment ? (
                      <div className="w-5 h-5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                    <span className="text-sm font-medium">
                      {attachmentsHook.uploadingAttachment ? 'Uploading...' : 'Upload file'}
                    </span>
                  </button>
                </div>

                {/* Attachment grid */}
                {attachmentsHook.projectAttachments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-neutral-400">
                    <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <p className="text-sm font-medium">No attachments</p>
                    <p className="text-xs mt-1">Upload files above</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {attachmentsHook.projectAttachments.map((attachment, index) => (
                      <div
                        key={attachment.id}
                        className="relative aspect-square rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 cursor-pointer"
                        onClick={() => {
                          // Open image in a simple view
                          if (attachment.file_type === 'image') {
                            window.open(attachment.url || attachment.file_url, '_blank');
                          }
                        }}
                      >
                        {attachment.file_type === 'image' ? (
                          <img
                            src={attachment.url || attachment.file_url}
                            alt={attachment.file_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center">
                            <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-[10px] text-neutral-500 mt-1 px-1 truncate max-w-full">
                              {attachment.file_name?.split('.').pop()?.toUpperCase() || 'FILE'}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="h-4" />
          </div>
        )}
        </div>

        {/* ── Comment Input (below scroll area, only on comments tab) ── */}
        {activeSection === 'comments' && (
          <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 safe-area-bottom">
            <div className="flex items-end gap-2">
              <textarea
                ref={commentInputRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handlePostComment();
                  }
                }}
                placeholder="Add a comment..."
                rows={1}
                className="flex-1 resize-none bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
              />
              <button
                onClick={handlePostComment}
                disabled={commentsHook.postingComment || !newComment.trim()}
                className="p-2 text-neutral-500 disabled:opacity-30 active:text-neutral-800 dark:active:text-neutral-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Inline Dropdown — glass card positioned below its trigger
// ============================================================================

function InlineDropdown({
  children,
  onClose,
  align = 'left',
}: {
  children: React.ReactNode;
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onTap(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onTap);
    document.addEventListener('touchstart', onTap);
    return () => {
      document.removeEventListener('mousedown', onTap);
      document.removeEventListener('touchstart', onTap);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1.5 z-[70] min-w-[200px] max-w-[280px] rounded-xl glass-card bg-white/85 dark:bg-neutral-900/90 border border-white/30 dark:border-white/10`}
    >
      <div className="relative overflow-hidden rounded-xl glass-sheen max-h-[50vh] overflow-y-auto py-1">
        {children}
      </div>
    </div>
  );
}
