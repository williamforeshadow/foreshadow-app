'use client';

import { useState, useCallback } from 'react';
import type { Comment, User } from '@/lib/types';

interface UseProjectCommentsProps {
  currentUser: User | null;
}

export function useProjectComments({ currentUser }: UseProjectCommentsProps) {
  const [projectComments, setProjectComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Fetch comments for a project
  const fetchProjectComments = useCallback(async (projectId: string) => {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/project-comments?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectComments(data.data);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
      setProjectComments([]);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  // Post a new comment (accepts comment text as parameter for window-independent state)
  const postProjectComment = useCallback(async (projectId: string, commentText?: string) => {
    const textToPost = commentText ?? newComment;
    if (!projectId || !textToPost.trim() || !currentUser) return;

    setPostingComment(true);
    try {
      const res = await fetch('/api/project-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          user_id: currentUser.id,
          comment_content: textToPost.trim()
        })
      });

      const data = await res.json();
      if (data.success && data.data) {
        setProjectComments(prev => [...prev, data.data]);
        // Only clear hook's newComment if we used it
        if (!commentText) {
          setNewComment('');
        }
      }
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setPostingComment(false);
    }
  }, [newComment, currentUser]);

  // Clear comments (for when project is deselected)
  const clearComments = useCallback(() => {
    setProjectComments([]);
    setNewComment('');
  }, []);

  return {
    projectComments,
    loadingComments,
    newComment,
    setNewComment,
    postingComment,
    fetchProjectComments,
    postProjectComment,
    clearComments,
  };
}

