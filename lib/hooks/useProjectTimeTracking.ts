'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimeEntry, User } from '@/lib/types';

interface UseProjectTimeTrackingProps {
  currentUser: User | null;
}

export function useProjectTimeTracking({ currentUser }: UseProjectTimeTrackingProps) {
  const [projectTimeEntries, setProjectTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimeEntry, setActiveTimeEntry] = useState<TimeEntry | null>(null);
  const [totalTrackedSeconds, setTotalTrackedSeconds] = useState(0);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch time entries for a project
  const fetchProjectTimeEntries = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/project-time-entries?project_id=${projectId}`);
      const data = await res.json();
      if (data.data) {
        setProjectTimeEntries(data.data);
        setTotalTrackedSeconds(data.totalSeconds || 0);
        setActiveTimeEntry(data.activeEntry || null);

        if (data.activeEntry) {
          const activeStart = new Date(data.activeEntry.start_time).getTime();
          const now = Date.now();
          const activeSeconds = Math.floor((now - activeStart) / 1000);
          setDisplaySeconds((data.totalSeconds || 0) + activeSeconds);
        } else {
          setDisplaySeconds(data.totalSeconds || 0);
        }
      }
    } catch (err) {
      console.error('Error fetching time entries:', err);
      setProjectTimeEntries([]);
      setTotalTrackedSeconds(0);
      setActiveTimeEntry(null);
      setDisplaySeconds(0);
    }
  }, []);

  // Start timer
  const startProjectTimer = useCallback(async (projectId: string) => {
    if (!projectId || !currentUser) return;

    try {
      const res = await fetch('/api/project-time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          user_id: currentUser.id
        })
      });

      const data = await res.json();
      if (data.data) {
        setActiveTimeEntry(data.data);
        setProjectTimeEntries(prev => [data.data, ...prev]);
      }
    } catch (err) {
      console.error('Error starting timer:', err);
    }
  }, [currentUser]);

  // Stop timer
  const stopProjectTimer = useCallback(async () => {
    if (!activeTimeEntry) return;

    try {
      const res = await fetch('/api/project-time-entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: activeTimeEntry.id
        })
      });

      const data = await res.json();
      if (data.data) {
        setProjectTimeEntries(prev =>
          prev.map(e => e.id === data.data.id ? data.data : e)
        );
        const entryDuration = Math.floor(
          (new Date(data.data.end_time).getTime() - new Date(data.data.start_time).getTime()) / 1000
        );
        setTotalTrackedSeconds(prev => prev + entryDuration);
        setActiveTimeEntry(null);
      }
    } catch (err) {
      console.error('Error stopping timer:', err);
    }
  }, [activeTimeEntry]);

  // Format time as HH:MM:SS
  const formatTime = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Clear time tracking state (for when project is deselected)
  const clearTimeTracking = useCallback(() => {
    setProjectTimeEntries([]);
    setTotalTrackedSeconds(0);
    setDisplaySeconds(0);
    // Note: we don't clear activeTimeEntry here as timer might still be running
  }, []);

  // Timer interval effect - updates display every second when timer is active
  useEffect(() => {
    if (activeTimeEntry) {
      timerIntervalRef.current = setInterval(() => {
        const activeStart = new Date(activeTimeEntry.start_time).getTime();
        const now = Date.now();
        const activeSeconds = Math.floor((now - activeStart) / 1000);
        setDisplaySeconds(totalTrackedSeconds + activeSeconds);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [activeTimeEntry, totalTrackedSeconds]);

  return {
    projectTimeEntries,
    activeTimeEntry,
    totalTrackedSeconds,
    displaySeconds,
    fetchProjectTimeEntries,
    startProjectTimer,
    stopProjectTimer,
    formatTime,
    clearTimeTracking,
  };
}

