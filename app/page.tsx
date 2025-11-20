'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OpenAI from 'openai';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

export default function Home() {
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [naturalQuery, setNaturalQuery] = useState('');
  const [generatedSQL, setGeneratedSQL] = useState('');
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [updatingCardAction, setUpdatingCardAction] = useState(false);
  const [isEditingAssignment, setIsEditingAssignment] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    cleanStatus: [] as string[],
    cardActions: [] as string[],
    staff: [] as string[],
    checkout: [] as string[],
    checkin: [] as string[]
  });

  const quickCall = async (rpcName: string) => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(rpcName, {});

      if (rpcError) {
        setError(rpcError.message);
      } else {
        setResponse(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to call RPC function');
    } finally {
      setLoading(false);
    }
  };

  const executeNaturalQuery = async () => {
    setIsExecutingQuery(true);
    setError(null);
    setResponse(null);
    setGeneratedSQL('');
    setAiSummary(null);
    
    try {
      const res = await fetch('/api/sql-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: naturalQuery })
      });
      
      const result = await res.json();
      
      if (result.error) {
        setError(`SQL Error: ${result.error}\n\nGenerated SQL:\n${result.sql || 'N/A'}`);
      } else {
        setGeneratedSQL(result.sql);
        setResponse(result.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const generateAISummary = async () => {
    if (!response) return;
    
    setIsGeneratingSummary(true);
    setAiSummary(null);
    
    try {
      const openai = new OpenAI({
        apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        dangerouslyAllowBrowser: true // Note: In production, call OpenAI from a server route
      });
  
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that summarizes property cleaning and reservation data in a clear, concise, and natural way. Focus on key information like property names, dates, guest names, and status."
          },
          {
            role: "user",
            content: `Please summarize this data in natural language:\n\n${JSON.stringify(response, null, 2)}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
  
      const summary = completion.choices[0]?.message?.content || 'No summary generated';
      setAiSummary(summary);
      
      // Automatically speak the summary
      speakText(summary);
      
    } catch (err: any) {
      setError(`AI Summary Error: ${err.message}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };
  
  const speakText = (text: string) => {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    if (!text) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  };
  
  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const updateCardAction = async (cleaningId: string, newAction: string) => {
    setUpdatingCardAction(true);
    try {
      const response = await fetch('/api/update-card-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaningId, action: newAction })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update card action');
      }

      // Update the local state with the complete card data (including recalculated property_clean_status)
      const updatedCard = result.data;
      
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => 
          item.id === cleaningId 
            ? { ...item, ...updatedCard }
            : item
        );
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });

      // Also update the selected card if still open
      setSelectedCard((prev: any) => 
        prev?.id === cleaningId 
          ? { ...prev, ...updatedCard }
          : null
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update card action');
    } finally {
      setUpdatingCardAction(false);
    }
  };

  const updateAssignment = async (cleaningId: string, staffName: string | null) => {
    setAssignmentLoading(true);
    try {
      const response = await fetch('/api/update-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaningId, staffName })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update assignment');
      }

      // Update the local state instead of re-fetching
      setResponse((prevResponse: any) => {
        if (!prevResponse) return prevResponse;
        
        const items = Array.isArray(prevResponse) ? prevResponse : [prevResponse];
        const updatedItems = items.map((item: any) => 
          item.id === cleaningId 
            ? { ...item, assigned_staff: staffName }
            : item
        );
        
        return Array.isArray(prevResponse) ? updatedItems : updatedItems[0];
      });

      // Update selected card locally to reflect change immediately
      setSelectedCard((prev: any) => ({ ...prev, assigned_staff: staffName }));
      setIsEditingAssignment(false);
      setNewStaffName('');
    } catch (err: any) {
      setError(err.message || 'Failed to update assignment');
    } finally {
      setAssignmentLoading(false);
    }
  };

  const getAvailableActions = (currentAction: string) => {
    switch (currentAction) {
      case 'not_started':
      case null:
      case undefined:
        return [
          { value: 'in_progress', label: '▶️ Start', icon: '▶️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'in_progress':
        return [
          { value: 'paused', label: '⏸️ Pause', icon: '⏸️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'paused':
        return [
          { value: 'in_progress', label: '▶️ Resume', icon: '▶️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
      case 'completed':
        return [
          { value: 'not_started', label: '↺ Reopen', icon: '↺' }
        ];
      default:
        return [
          { value: 'in_progress', label: '▶️ Start', icon: '▶️' },
          { value: 'completed', label: '✅ Mark Complete', icon: '✅' }
        ];
    }
  };

  const toggleFilter = (category: keyof typeof filters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value]
    }));
  };

  const clearAllFilters = () => {
    setFilters({
      cleanStatus: [],
      cardActions: [],
      staff: [],
      checkout: [],
      checkin: []
    });
  };

  const getUniqueStaff = (items: any[]) => {
    const staff = items
      .map(item => item.assigned_staff)
      .filter(s => s !== null && s !== undefined);
    return Array.from(new Set(staff)).sort();
  };

  const applyFilters = (items: any[]) => {
    return items.filter(item => {
      const now = new Date();
      const checkoutDate = item.check_out ? new Date(item.check_out) : null;
      const checkinDate = item.next_check_in ? new Date(item.next_check_in) : null;
      
      // Clean Status filter
      if (filters.cleanStatus.length > 0) {
        if (!filters.cleanStatus.includes(item.property_clean_status || '')) {
          return false;
        }
      }
      
      // Card Actions filter
      if (filters.cardActions.length > 0) {
        if (!filters.cardActions.includes(item.card_actions || 'not_started')) {
          return false;
        }
      }
      
      // Staff filter
      if (filters.staff.length > 0) {
        if (filters.staff.includes('unassigned')) {
          if (item.assigned_staff !== null && item.assigned_staff !== undefined) {
            if (!filters.staff.includes(item.assigned_staff)) {
              return false;
            }
          }
        } else {
          if (!filters.staff.includes(item.assigned_staff)) {
            return false;
          }
        }
      }
      
      // Checkout filter
      if (filters.checkout.length > 0) {
        let checkoutMatch = false;
        if (checkoutDate) {
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const tomorrowStart = new Date(todayStart);
          tomorrowStart.setDate(tomorrowStart.getDate() + 1);
          
          if (filters.checkout.includes('already_checked_out') && checkoutDate < now) {
            checkoutMatch = true;
          }
          if (filters.checkout.includes('checking_out_today') && 
              checkoutDate >= todayStart && checkoutDate < tomorrowStart) {
            checkoutMatch = true;
          }
          if (filters.checkout.includes('checking_out_tomorrow') && 
              checkoutDate >= tomorrowStart) {
            const dayAfterTomorrow = new Date(tomorrowStart);
            dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
            if (checkoutDate < dayAfterTomorrow) {
              checkoutMatch = true;
            }
          }
        }
        if (!checkoutMatch) return false;
      }
      
      // Check-in filter
      if (filters.checkin.length > 0) {
        let checkinMatch = false;
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrowStart = new Date(todayStart);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        
        if (filters.checkin.includes('no_next_guest') && !checkinDate) {
          checkinMatch = true;
        }
        if (checkinDate) {
          if (filters.checkin.includes('checkin_today') && 
              checkinDate >= todayStart && checkinDate < tomorrowStart) {
            checkinMatch = true;
          }
          if (filters.checkin.includes('checkin_tomorrow')) {
            const dayAfterTomorrow = new Date(tomorrowStart);
            dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
            if (checkinDate >= tomorrowStart && checkinDate < dayAfterTomorrow) {
              checkinMatch = true;
            }
          }
          if (filters.checkin.includes('checkin_this_week')) {
            const weekFromNow = new Date(todayStart);
            weekFromNow.setDate(weekFromNow.getDate() + 7);
            if (checkinDate >= todayStart && checkinDate < weekFromNow) {
              checkinMatch = true;
            }
          }
        }
        if (!checkinMatch) return false;
      }
      
      return true;
    });
  };

  const getActiveFilterCount = () => {
    return filters.cleanStatus.length + filters.cardActions.length + 
           filters.staff.length + filters.checkout.length + filters.checkin.length;
  };
  
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getCardBackgroundColor = (status: string) => {
    switch (status) {
      case 'needs_cleaning':
        return 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900';
      case 'cleaning_scheduled':
        return 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900';
      case 'cleaning_complete':
        return 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900';
      default:
        return 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700';
    }
  };

  const getSortPriority = (status: string) => {
    switch (status) {
      case 'needs_cleaning':
        return 1; // Red first
      case 'cleaning_scheduled':
        return 2; // Yellow second
      case 'cleaning_complete':
        return 3; // Green last
      default:
        return 4;
    }
  };

  const renderCards = () => {
    if (!response) return null;
    
    // Ensure response is an array
    let items = Array.isArray(response) ? response : [response];
    
    if (items.length === 0) {
      return (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          No results found
        </div>
      );
    }

    // Apply filters
    const totalCount = items.length;
    items = applyFilters(items);
    
    if (items.length === 0) {
      return (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          No cards match the selected filters
        </div>
      );
    }

    // Sort items: first by status priority (red, yellow, green), then by next_check_in
    items = [...items].sort((a, b) => {
      // First sort by status priority
      const priorityA = getSortPriority(a.property_clean_status);
      const priorityB = getSortPriority(b.property_clean_status);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // If same status, sort by next_check_in (soonest first)
      const dateA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
      const dateB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
      
      return dateA - dateB;
    });

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {items.map((item, index) => (
          <Card
            key={item.cleaning_id || item.id || index}
            onClick={() => setSelectedCard(item)}
            className={`cursor-pointer hover:shadow-xl transition-all duration-200 ${getCardBackgroundColor(item.property_clean_status)}`}
          >
            <CardHeader>
              <CardTitle>{item.property_name || 'Unknown Property'}</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {item.guest_name || <span className="italic opacity-60">No guest</span>}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Dates */}
              <div className="space-y-2.5">
                {/* Checked Out */}
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Checked out</div>
                    <div className="text-sm truncate font-medium text-slate-900 dark:text-white">
                      {item.check_out ? formatDate(item.check_out) : <span className="italic opacity-60">Not set</span>}
                    </div>
                  </div>
                </div>

                {/* Next Check In */}
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Next check in</div>
                    <div className="text-sm truncate font-medium text-slate-900 dark:text-white">
                      {item.next_check_in ? formatDate(item.next_check_in) : <span className="italic opacity-60">Not set</span>}
                    </div>
                  </div>
                </div>

                {/* Scheduled Start */}
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Scheduled</div>
                    <div className="text-sm truncate font-medium text-slate-900 dark:text-white">
                      {item.scheduled_start ? formatDate(item.scheduled_start) : <span className="italic opacity-60">Not set</span>}
                    </div>
                  </div>
                </div>

                {/* Card Actions - Read Only */}
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Action</div>
                    <div className={`text-sm font-medium ${
                      item.card_actions === 'in_progress' ? 'text-blue-600 dark:text-blue-400' :
                      item.card_actions === 'paused' ? 'text-orange-600 dark:text-orange-400' :
                      item.card_actions === 'completed' ? 'text-green-600 dark:text-green-400' :
                      'text-slate-600 dark:text-slate-400'
                    }`}>
                      {item.card_actions === 'not_started' ? 'Not Started' :
                       item.card_actions === 'in_progress' ? 'In Progress' :
                       item.card_actions === 'paused' ? 'Paused' :
                       item.card_actions === 'completed' ? 'Completed' :
                       'Not Started'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge 
                  variant={
                    item.property_clean_status === 'needs_cleaning' ? 'destructive' :
                    item.property_clean_status === 'cleaning_complete' ? 'default' : 'secondary'
                  }
                  className={
                    item.property_clean_status === 'needs_cleaning' 
                      ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300'
                      : item.property_clean_status === 'cleaning_scheduled'
                      ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300'
                      : item.property_clean_status === 'cleaning_complete'
                      ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-300'
                      : ''
                  }
                >
                  {item.property_clean_status === 'needs_cleaning' ? 'Needs Cleaning' :
                   item.property_clean_status === 'cleaning_scheduled' ? 'Scheduled' :
                   item.property_clean_status === 'cleaning_complete' ? 'Complete' :
                   'Unknown'}
                </Badge>
                
                <Badge variant={item.assigned_staff ? 'default' : 'outline'}>
                  {item.assigned_staff ? item.assigned_staff : 'Unassigned'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <div className="flex-1 overflow-auto flex items-center justify-center p-8">
        <div className="w-full max-w-6xl">
        <h1 className="text-3xl font-bold mb-8 text-slate-900 dark:text-white text-center">
          Property Management Dashboard
        </h1>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-6">
            <p className="text-sm font-medium text-red-800 dark:text-red-400">Error:</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
          </div>
        )}

        {/* Quick Access Button */}
        <div className="mb-8">
          <Button
            onClick={() => quickCall('get_property_turnovers')}
            disabled={loading}
            size="lg"
            className="w-full text-lg py-6"
          >
            {loading ? 'Loading...' : 'Property Status'}
          </Button>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800 space-y-4">

          {/* Response Display */}
          {response !== null && (
            <div className="space-y-3">
              {/* Filter Bar */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    <span className="font-medium">Filters</span>
                    {getActiveFilterCount() > 0 && (
                      <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full">
                        {getActiveFilterCount()}
                      </span>
                    )}
                    <svg className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {getActiveFilterCount() > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {showFilters && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                    {/* Clean Status */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Clean Status</h4>
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.cleanStatus.includes('needs_cleaning')}
                            onChange={() => toggleFilter('cleanStatus', 'needs_cleaning')}
                            className="rounded border-slate-300"
                          />
                          <span>Needs Cleaning</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.cleanStatus.includes('cleaning_scheduled')}
                            onChange={() => toggleFilter('cleanStatus', 'cleaning_scheduled')}
                            className="rounded border-slate-300"
                          />
                          <span>Scheduled</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.cleanStatus.includes('cleaning_complete')}
                            onChange={() => toggleFilter('cleanStatus', 'cleaning_complete')}
                            className="rounded border-slate-300"
                          />
                          <span>Complete</span>
                        </label>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Card Actions</h4>
                      <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.cardActions.includes('not_started')}
                      onChange={() => toggleFilter('cardActions', 'not_started')}
                      className="rounded border-slate-300"
                    />
                    <span>Not Started</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.cardActions.includes('in_progress')}
                      onChange={() => toggleFilter('cardActions', 'in_progress')}
                      className="rounded border-slate-300"
                    />
                    <span>In Progress</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.cardActions.includes('paused')}
                      onChange={() => toggleFilter('cardActions', 'paused')}
                      className="rounded border-slate-300"
                    />
                    <span>Paused</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.cardActions.includes('completed')}
                      onChange={() => toggleFilter('cardActions', 'completed')}
                      className="rounded border-slate-300"
                    />
                    <span>Completed</span>
                  </label>
                      </div>
                    </div>

                    {/* Staff */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Staff</h4>
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.staff.includes('unassigned')}
                            onChange={() => toggleFilter('staff', 'unassigned')}
                            className="rounded border-slate-300"
                          />
                          <span>Unassigned</span>
                        </label>
                        {response && getUniqueStaff(Array.isArray(response) ? response : [response]).map(staff => (
                          <label key={staff} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.staff.includes(staff)}
                              onChange={() => toggleFilter('staff', staff)}
                              className="rounded border-slate-300"
                            />
                            <span>{staff}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Checkout Status */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Checkout</h4>
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkout.includes('already_checked_out')}
                            onChange={() => toggleFilter('checkout', 'already_checked_out')}
                            className="rounded border-slate-300"
                          />
                          <span>Already Out</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkout.includes('checking_out_today')}
                            onChange={() => toggleFilter('checkout', 'checking_out_today')}
                            className="rounded border-slate-300"
                          />
                          <span>Today</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkout.includes('checking_out_tomorrow')}
                            onChange={() => toggleFilter('checkout', 'checking_out_tomorrow')}
                            className="rounded border-slate-300"
                          />
                          <span>Tomorrow</span>
                        </label>
                      </div>
                    </div>

                    {/* Check-in Status */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Next Check-in</h4>
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkin.includes('no_next_guest')}
                            onChange={() => toggleFilter('checkin', 'no_next_guest')}
                            className="rounded border-slate-300"
                          />
                          <span>No Next Guest</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkin.includes('checkin_today')}
                            onChange={() => toggleFilter('checkin', 'checkin_today')}
                            className="rounded border-slate-300"
                          />
                          <span>Today</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkin.includes('checkin_tomorrow')}
                            onChange={() => toggleFilter('checkin', 'checkin_tomorrow')}
                            className="rounded border-slate-300"
                          />
                          <span>Tomorrow</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.checkin.includes('checkin_this_week')}
                            onChange={() => toggleFilter('checkin', 'checkin_this_week')}
                            className="rounded border-slate-300"
                          />
                          <span>This Week</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {Array.isArray(response) && getActiveFilterCount() > 0 ? (
                    <>Showing {applyFilters(response).length} of {response.length} cards</>
                  ) : (
                    <>Response: {Array.isArray(response) ? `${response.length} item(s)` : '1 item'}</>
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewMode('cards')}
                    className={`px-3 py-1 text-xs font-medium rounded ${
                      viewMode === 'cards'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Cards
                  </button>
                  <button
                    onClick={() => setViewMode('json')}
                    className={`px-3 py-1 text-xs font-medium rounded ${
                      viewMode === 'json'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              <div className="overflow-auto max-h-96">
                {viewMode === 'cards' ? (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
                    {renderCards()}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                    <pre className="text-sm text-slate-900 dark:text-slate-100 font-mono whitespace-pre-wrap">
                      {JSON.stringify(response, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Summary Section */}
          {response !== null && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  🤖 AI Summary
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={generateAISummary}
                    disabled={isGeneratingSummary || isSpeaking}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {isGeneratingSummary ? '🔄 Generating...' : '✨ Generate Summary'}
                  </button>
                  
                  {isSpeaking && (
                    <button
                      onClick={stopSpeaking}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                    >
                      🔇 Stop Speaking
                    </button>
                  )}
                </div>
              </div>
              
              {aiSummary && (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">
                      {isSpeaking ? '🔊' : '💬'}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-900 dark:text-white leading-relaxed">
                        {aiSummary}
                      </p>
                      <button
                        onClick={() => speakText(aiSummary)}
                        disabled={isSpeaking}
                        className="mt-3 text-xs text-purple-600 dark:text-purple-400 hover:underline disabled:opacity-50"
                      >
                        🔊 Read again
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Natural Language Query */}
        <div className="mt-8 bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Natural Language Query
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
              💡 Tip: Start with <code className="text-purple-600 dark:text-purple-400">/cards</code> for card results
            </span>
          </div>
          
          <div className="space-y-3">
            <textarea
              value={naturalQuery}
              onChange={(e) => setNaturalQuery(e.target.value)}
              placeholder="e.g., /cards show unassigned cleanings"
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
            />
            
            <Button
              onClick={executeNaturalQuery}
              disabled={isExecutingQuery || !naturalQuery}
              size="lg"
              className="w-full text-lg py-6 bg-purple-600 hover:bg-purple-700"
            >
              {isExecutingQuery ? '⚡ Generating & Running...' : '⚡ Run Query'}
            </Button>
            
            {generatedSQL && (
              <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Generated SQL:
                </p>
                <pre className="text-xs text-slate-900 dark:text-white font-mono overflow-x-auto">
                  {generatedSQL}
                </pre>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Card Detail Modal */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent 
          className={`max-w-md max-h-[90vh] overflow-y-auto border-2 ${
            selectedCard?.property_clean_status === 'needs_cleaning' ? 'border-red-400' :
            selectedCard?.property_clean_status === 'cleaning_scheduled' ? 'border-yellow-400' :
            selectedCard?.property_clean_status === 'cleaning_complete' ? 'border-emerald-400' :
            'border-slate-300'
          }`}
        >
          {selectedCard && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">{selectedCard.property_name || 'Unknown Property'}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-base">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {selectedCard.guest_name || 'No guest'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
              {/* Dates */}
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Checked out</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {selectedCard.check_out ? formatDate(selectedCard.check_out) : 'Not set'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Next check in</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {selectedCard.next_check_in ? formatDate(selectedCard.next_check_in) : 'Not set'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Scheduled</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {selectedCard.scheduled_start ? formatDate(selectedCard.scheduled_start) : 'Not set'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge
                  variant={
                    selectedCard.property_clean_status === 'needs_cleaning' ? 'destructive' :
                    selectedCard.property_clean_status === 'cleaning_complete' ? 'default' : 'secondary'
                  }
                  className={`text-sm py-1.5 ${
                    selectedCard.property_clean_status === 'needs_cleaning' 
                      ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300'
                      : selectedCard.property_clean_status === 'cleaning_scheduled'
                      ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300'
                      : selectedCard.property_clean_status === 'cleaning_complete'
                      ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-300'
                      : ''
                  }`}
                >
                  {selectedCard.property_clean_status === 'needs_cleaning' ? 'Needs Cleaning' :
                   selectedCard.property_clean_status === 'cleaning_scheduled' ? 'Scheduled' :
                   selectedCard.property_clean_status === 'cleaning_complete' ? 'Complete' :
                   'Unknown'}
                </Badge>
                
                <div className="flex-1">
                  {isEditingAssignment ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <select
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500"
                          onChange={(e) => {
                            if (e.target.value === 'new') {
                              setNewStaffName('');
                            } else {
                              updateAssignment(selectedCard.id, e.target.value || null);
                            }
                          }}
                          value={selectedCard.assigned_staff || ''}
                          disabled={assignmentLoading}
                        >
                          <option value="">Unassigned</option>
                          {response && getUniqueStaff(Array.isArray(response) ? response : [response]).map(staff => (
                            <option key={staff} value={staff}>{staff}</option>
                          ))}
                          <option value="new">+ Add New Staff...</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsEditingAssignment(false)}
                        >
                          ✕
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Or type new name..."
                          value={newStaffName}
                          onChange={(e) => setNewStaffName(e.target.value)}
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500"
                        />
                        <Button
                          onClick={() => {
                            if (newStaffName.trim()) {
                              updateAssignment(selectedCard.id, newStaffName.trim());
                            }
                          }}
                          disabled={!newStaffName.trim() || assignmentLoading}
                          size="sm"
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Badge
                      onClick={() => setIsEditingAssignment(true)}
                      variant={selectedCard.assigned_staff ? 'default' : 'outline'}
                      className="cursor-pointer hover:opacity-80 text-sm py-1.5"
                    >
                      {selectedCard.assigned_staff ? (
                        <>{selectedCard.assigned_staff}</>
                      ) : (
                        <>Unassigned <span className="ml-1 text-xs opacity-60">(Click to assign)</span></>
                      )}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-200 dark:border-slate-800 my-4"></div>

              {/* Current Action Status */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Current Action</div>
                <div className={`text-base font-semibold ${
                  selectedCard.card_actions === 'in_progress' ? 'text-blue-600 dark:text-blue-400' :
                  selectedCard.card_actions === 'paused' ? 'text-orange-600 dark:text-orange-400' :
                  selectedCard.card_actions === 'completed' ? 'text-green-600 dark:text-green-400' :
                  'text-slate-600 dark:text-slate-400'
                }`}>
                  {selectedCard.card_actions === 'not_started' ? 'Not Started' :
                   selectedCard.card_actions === 'in_progress' ? 'In Progress' :
                   selectedCard.card_actions === 'paused' ? 'Paused' :
                   selectedCard.card_actions === 'completed' ? 'Completed' :
                   'Not Started'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 mt-4">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Change Action</div>
                {getAvailableActions(selectedCard.card_actions).map((action) => (
                  <Button
                    key={action.value}
                    onClick={() => updateCardAction(selectedCard.id, action.value)}
                    disabled={updatingCardAction}
                    variant="outline"
                    size="lg"
                    className="w-full justify-start"
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>

            <DialogFooter className="border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setSelectedCard(null)}
                className="w-full"
              >
                Close
              </Button>
            </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

