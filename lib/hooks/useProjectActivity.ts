'use client';

import { useState, useCallback } from 'react';
import type { ActivityLogEntry } from '@/lib/types';

export function useProjectActivity() {
  const [projectActivity, setProjectActivity] = useState<ActivityLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);

  // Fetch activity log for a project
  const fetchProjectActivity = useCallback(async (projectId: string, limit = 50) => {
    setLoadingActivity(true);
    try {
      const res = await fetch(`/api/project-activity?project_id=${projectId}&limit=${limit}`);
      const data = await res.json();
      if (data.data) {
        setProjectActivity(data.data);
      }
    } catch (err) {
      console.error('Error fetching activity:', err);
      setProjectActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  // Clear activity (for when project is deselected)
  const clearActivity = useCallback(() => {
    setProjectActivity([]);
  }, []);

  return {
    projectActivity,
    loadingActivity,
    activityPopoverOpen,
    setActivityPopoverOpen,
    fetchProjectActivity,
    clearActivity,
  };
}

