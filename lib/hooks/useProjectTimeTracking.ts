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

  // Ref always tracks latest activeTimeEntry — avoids stale closures in stopProjectTimer
  const activeTimeEntryRef = useRef<TimeEntry | null>(null);
  activeTimeEntryRef.current = activeTimeEntry;

  // Guards against concurrent start/stop calls
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);

  // Fetch time entries for a project or task
  const fetchProjectTimeEntries = useCallback(async (entityId: string, entityType: 'project' | 'task' = 'project') => {
    try {
      const param = entityType === 'task' ? 'task_id' : 'project_id';
      const res = await fetch(`/api/project-time-entries?${param}=${entityId}`);
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

  // Start timer — guarded against duplicate concurrent calls
  const startProjectTimer = useCallback(async (entityId: string, entityType: 'project' | 'task' = 'project') => {
    if (!entityId || !currentUser) return;
    if (activeTimeEntryRef.current) return;
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      const bodyData: Record<string, string> = {
        user_id: currentUser.id,
      };
      if (entityType === 'task') {
        bodyData.task_id = entityId;
      } else {
        bodyData.project_id = entityId;
      }

      const res = await fetch('/api/project-time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      const data = await res.json();
      if (data.data) {
        setActiveTimeEntry(data.data);
        setProjectTimeEntries(prev => [data.data, ...prev]);
      }
    } catch (err) {
      console.error('Error starting timer:', err);
    } finally {
      startingRef.current = false;
    }
  }, [currentUser]);

  // Stop timer — reads from ref so it never has a stale closure
  const stopProjectTimer = useCallback(async () => {
    const entry = activeTimeEntryRef.current;
    if (!entry) return;
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    // Optimistically clear so no duplicate calls can slip through
    setActiveTimeEntry(null);

    try {
      const res = await fetch('/api/project-time-entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: entry.id
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
      }
    } catch (err) {
      console.error('Error stopping timer:', err);
      // Restore on failure so UI stays consistent
      setActiveTimeEntry(entry);
    } finally {
      stoppingRef.current = false;
    }
  }, []);

  // Format time as HH:MM:SS
  const formatTime = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Clear all time tracking state (when switching tasks or closing panel)
  const clearTimeTracking = useCallback(() => {
    setProjectTimeEntries([]);
    setTotalTrackedSeconds(0);
    setDisplaySeconds(0);
    setActiveTimeEntry(null);
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

