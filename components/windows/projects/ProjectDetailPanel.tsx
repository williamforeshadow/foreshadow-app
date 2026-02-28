'use client';

import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DebouncedNativeInput, DebouncedTextarea } from '@/components/ui/debounced-input';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
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
import type { Project, User, ProjectFormFields, Comment, Attachment, TimeEntry } from '@/lib/types';

interface ProjectDetailPanelProps {
  project: Project;
  editingFields: ProjectFormFields;
  setEditingFields: (fields: ProjectFormFields | null | ((prev: ProjectFormFields | null) => ProjectFormFields | null)) => void;
  users: User[];
  savingEdit: boolean;
  onSave: () => void;
  onDelete: (project: Project) => void;
  onClose: () => void;
  onOpenActivity: () => void;
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
  savingEdit,
  onSave,
  onDelete,
  onClose,
  onOpenActivity,
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
  return (
    <div className="w-full h-full flex flex-col bg-card">
      {/* Header */}
      <div className="flex-shrink-0 bg-card z-10 border-b border-neutral-200 dark:border-neutral-700 relative">
        <div className="absolute top-1 right-1 flex gap-0.5">
          <button
            onClick={onOpenActivity}
            className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
            title="Activity History"
          >
            <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (confirm('Are you sure you want to delete this project?')) {
                onDelete(project);
              }
            }}
            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            title="Delete project"
          >
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
            title="Close"
          >
            <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col space-y-3 px-4 py-3">
          <DebouncedNativeInput
            type="text"
            value={editingFields.title}
            onChange={(value) => setEditingFields(prev => prev ? {...prev, title: value} : null)}
            onBlur={onSave}
            placeholder="Untitled Project"
            className="text-lg font-semibold bg-transparent border-none outline-none focus:outline-none p-0 flex-1 min-w-0 text-foreground placeholder:text-muted-foreground"
            delay={150}
          />

          <div className="flex items-center justify-between">
            <p className="text-base text-muted-foreground">{project.property_name}</p>

            <div className="flex items-center gap-2">
              {/* Status dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="focus:outline-none">
                    <Badge
                      variant="outline"
                      className={cn(
                        "cursor-pointer hover:opacity-80 transition-opacity border-transparent",
                        editingFields.status === 'not_started' && "bg-neutral-500 text-white",
                        editingFields.status === 'in_progress' && "bg-blue-500 text-white",
                        editingFields.status === 'on_hold' && "bg-amber-500 text-white",
                        editingFields.status === 'complete' && "bg-emerald-500 text-white"
                      )}
                    >
                      {(editingFields.status?.replace('_', ' ') || 'not started').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                    </Badge>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuCheckboxItem
                    checked={editingFields.status === 'not_started'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, status: 'not_started'} : null); setTimeout(onSave, 0); }}
                  >
                    Not Started
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={editingFields.status === 'in_progress'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, status: 'in_progress'} : null); setTimeout(onSave, 0); }}
                  >
                    In Progress
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={editingFields.status === 'on_hold'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, status: 'on_hold'} : null); setTimeout(onSave, 0); }}
                  >
                    On Hold
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={editingFields.status === 'complete'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, status: 'complete'} : null); setTimeout(onSave, 0); }}
                  >
                    Complete
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Priority dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="focus:outline-none">
                    <Badge
                      variant="outline"
                      className={cn(
                        "cursor-pointer hover:opacity-80 transition-opacity border-transparent",
                        editingFields.priority === 'low' && "bg-slate-500 text-white",
                        editingFields.priority === 'medium' && "bg-sky-500 text-white",
                        editingFields.priority === 'high' && "bg-orange-500 text-white",
                        editingFields.priority === 'urgent' && "bg-red-500 text-white"
                      )}
                    >
                      {editingFields.priority ? editingFields.priority.charAt(0).toUpperCase() + editingFields.priority.slice(1) : 'Low'}
                    </Badge>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuCheckboxItem
                    checked={editingFields.priority === 'low'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, priority: 'low'} : null); setTimeout(onSave, 0); }}
                  >
                    Low
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={editingFields.priority === 'medium'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, priority: 'medium'} : null); setTimeout(onSave, 0); }}
                  >
                    Medium
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={editingFields.priority === 'high'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, priority: 'high'} : null); setTimeout(onSave, 0); }}
                  >
                    High
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={editingFields.priority === 'urgent'}
                    onCheckedChange={() => { setEditingFields(prev => prev ? {...prev, priority: 'urgent'} : null); setTimeout(onSave, 0); }}
                  >
                    Urgent
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Time tracker */}
          {(displaySeconds > 0 || activeTimeEntry) && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-muted-foreground">
                {formatTime(displaySeconds)}
              </span>
              {activeTimeEntry ? (
                <Button size="sm" variant="outline" onClick={onStopTimer}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={onStartTimer}>
                  Resume
                </Button>
              )}
            </div>
          )}

          {!activeTimeEntry && displaySeconds === 0 && (
            <Button size="sm" variant="outline" onClick={onStartTimer} className="w-fit">
              Start Timer
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1 min-h-0 overscroll-contain">
        <div className="px-4 py-4 space-y-4">
          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Description</label>
            <DebouncedTextarea
              value={editingFields.description}
              onChange={(value) => setEditingFields(prev => prev ? {...prev, description: value} : null)}
              onBlur={onSave}
              placeholder="Add a description..."
              rows={3}
              className="resize-none"
              delay={150}
            />
          </div>

          {/* Assigned & Due Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Assigned To</label>
              <Popover open={staffOpen} onOpenChange={setStaffOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {editingFields.assigned_staff
                      ? users.find((user) => user.id === editingFields.assigned_staff)?.name || "Unknown"
                      : "Select staff..."}
                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
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
                            {user.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Scheduled Date</label>
              <Input
                type="date"
                value={editingFields.scheduled_date}
                onChange={(e) => {
                  setEditingFields(prev => prev ? {...prev, scheduled_date: e.target.value} : null);
                  setTimeout(onSave, 0);
                }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Scheduled Time</label>
              <Input
                type="time"
                value={editingFields.scheduled_time}
                onChange={(e) => {
                  setEditingFields(prev => prev ? {...prev, scheduled_time: e.target.value} : null);
                  setTimeout(onSave, 0);
                }}
              />
            </div>
          </div>
        </div>

        {/* Attachments Section - Thumbnails Only (only show if there are attachments) */}
        {(loadingAttachments || attachments.length > 0) && (
          <div className="border-t border-neutral-200 dark:border-neutral-700">
            <div className="px-4 py-4 flex items-center gap-3 flex-wrap">
              {loadingAttachments ? (
                <span className="text-sm text-muted-foreground">Loading attachments...</span>
              ) : (
                attachments.map((attachment, index) => (
                  <div
                    key={attachment.id}
                    className="relative w-12 h-12 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewAttachment(index);
                    }}
                  >
                    {attachment.file_type === 'image' ? (
                      <img src={attachment.url || attachment.file_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                        <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Comments Section */}
        <div className="border-t border-neutral-200 dark:border-neutral-700">
          <div className="px-4 py-4 space-y-4">
            {loadingComments ? (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">Loading comments...</p>
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">No comments yet</p>
              </div>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                    {(comment.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">
                        {comment.user_name || 'Unknown User'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(comment.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {comment.comment_content}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <ScrollBar />
      </ScrollArea>

      {/* Comment Input - Sticky at bottom */}
      <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-700 px-4 py-3 bg-card">
        <div className="flex items-center gap-2">
          <DebouncedTextarea
            placeholder="Add a comment..."
            rows={1}
            className="resize-none min-h-[38px] flex-1"
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
          {/* Hidden file input */}
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={onAttachmentUpload}
          />
          {/* Paperclip attachment button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="flex-shrink-0"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={uploadingAttachment}
          >
            {uploadingAttachment ? (
              <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
          </Button>
        </div>
      </div>

    </div>
  );
}

