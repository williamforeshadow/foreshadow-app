'use client';

import { useState, useCallback, useRef } from 'react';
import type { Attachment, User } from '@/lib/types';

interface UseProjectAttachmentsProps {
  currentUser: User | null;
}

export function useProjectAttachments({ currentUser }: UseProjectAttachmentsProps) {
  const [projectAttachments, setProjectAttachments] = useState<Attachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Fetch attachments for a project
  const fetchProjectAttachments = useCallback(async (projectId: string) => {
    setLoadingAttachments(true);
    try {
      const res = await fetch(`/api/project-attachments?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectAttachments(data.data);
      }
    } catch (err) {
      console.error('Error fetching attachments:', err);
      setProjectAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  }, []);

  // Handle file upload
  const handleAttachmentUpload = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    projectId: string
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !projectId || !currentUser) return;

    setUploadingAttachment(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('project_id', projectId);
        formData.append('uploaded_by', currentUser.id);

        const res = await fetch('/api/project-attachments', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (data.data) {
          setProjectAttachments(prev => [data.data, ...prev]);
        }
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
    }
  }, [currentUser]);

  // Navigate between attachments in viewer
  const navigateAttachment = useCallback((direction: 'prev' | 'next') => {
    if (viewingAttachmentIndex === null || projectAttachments.length === 0) return;
    const newIndex = direction === 'prev'
      ? (viewingAttachmentIndex - 1 + projectAttachments.length) % projectAttachments.length
      : (viewingAttachmentIndex + 1) % projectAttachments.length;
    setViewingAttachmentIndex(newIndex);
  }, [viewingAttachmentIndex, projectAttachments.length]);

  // Clear attachments (for when project is deselected)
  const clearAttachments = useCallback(() => {
    setProjectAttachments([]);
    setViewingAttachmentIndex(null);
  }, []);

  return {
    projectAttachments,
    loadingAttachments,
    uploadingAttachment,
    viewingAttachmentIndex,
    setViewingAttachmentIndex,
    attachmentInputRef,
    fetchProjectAttachments,
    handleAttachmentUpload,
    navigateAttachment,
    clearAttachments,
  };
}

