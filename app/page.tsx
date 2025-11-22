'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OpenAI from 'openai';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ChatPopup from '@/components/ChatPopup';
import Timeline from '@/components/Timeline';
import FloatingWindow from '@/components/FloatingWindow';

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
    staff: [] as string[]
  });
  const [sortBy, setSortBy] = useState('status-priority');
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);

  // Auto-load data on mount
  useEffect(() => {
    quickCall('get_property_turnovers');
  }, []);

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
      
      return true;
    });
  };

  const sortItems = (items: any[]) => {
    const now = new Date().getTime(); // Current timestamp
    
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case 'status-priority':
          // Sort by status priority (red, yellow, green), then by next_check_in
          const priorityA = getSortPriority(a.property_clean_status);
          const priorityB = getSortPriority(b.property_clean_status);
          
          if (priorityA !== priorityB) {
            return priorityA - priorityB;
          }
          
          // If same status, sort by next_check_in (future dates first, soonest to latest)
          const dateA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
          const dateB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
          
          // Treat past dates as farther in the future (push to bottom)
          const futureA = dateA < now ? Infinity : dateA;
          const futureB = dateB < now ? Infinity : dateB;
          
          return futureA - futureB;

        case 'checkin-soonest':
          // Next Check-in: Soonest First (only future dates, push past to bottom)
          const checkinA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
          const checkinB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
          
          // Treat past dates as Infinity (push to bottom)
          const futureCheckinA = checkinA < now ? Infinity : checkinA;
          const futureCheckinB = checkinB < now ? Infinity : checkinB;
          
          return futureCheckinA - futureCheckinB;

        case 'checkout-recent':
          // Checkout: Most Recent First (closest to today, prioritizing recent past)
          const checkoutRecentA = a.check_out ? new Date(a.check_out).getTime() : Infinity;
          const checkoutRecentB = b.check_out ? new Date(b.check_out).getTime() : Infinity;
          
          // Calculate distance from now (recent past checkouts first)
          const distanceA = Math.abs(checkoutRecentA - now);
          const distanceB = Math.abs(checkoutRecentB - now);
          
          // Prioritize past dates over future dates
          const isPastA = checkoutRecentA <= now;
          const isPastB = checkoutRecentB <= now;
          
          if (isPastA && !isPastB) return -1; // A is past, B is future -> A first
          if (!isPastA && isPastB) return 1;  // A is future, B is past -> B first
          
          // Both past or both future: sort by distance from now
          return distanceA - distanceB;

        case 'checkout-oldest':
          // Checkout: Oldest First
          const checkoutOldestA = a.check_out ? new Date(a.check_out).getTime() : Infinity;
          const checkoutOldestB = b.check_out ? new Date(b.check_out).getTime() : Infinity;
          return checkoutOldestA - checkoutOldestB;

        case 'property-az':
          // Property Name: A-Z
          return (a.property_name || '').localeCompare(b.property_name || '');

        default:
          return 0;
      }
    });
  };

  const getActiveFilterCount = () => {
    return filters.cleanStatus.length + filters.cardActions.length + filters.staff.length;
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

    // Apply sorting
    items = sortItems(items);

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
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <Sidebar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fixed Header */}
        <div className="flex-shrink-0 p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Property Management Dashboard
            </h1>
            
            {/* Window Controls */}
            <div className="flex gap-2">
              <Button
                onClick={() => setShowCardsWindow(!showCardsWindow)}
                variant={showCardsWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Cards
              </Button>
              <Button
                onClick={() => setShowTimelineWindow(!showTimelineWindow)}
                variant={showTimelineWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Timeline
              </Button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-medium text-red-800 dark:text-red-400">Error:</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Floating Windows Container */}
        <div className="flex-1 relative overflow-hidden">
          {/* Cards Window */}
          {showCardsWindow && (
            <FloatingWindow
              id="cards"
              title="Cards View"
              defaultPosition={{ x: 50, y: 50 }}
              defaultSize={{ width: '70%', height: '80%' }}
              onClose={() => setShowCardsWindow(false)}
            >
              <div className="p-6 space-y-4">
          {/* Response Display */}
          {response !== null && (
            <div className="space-y-3">
              {/* Filter and Sort Bar */}
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

                  <div className="flex items-center gap-3">
                    {getActiveFilterCount() > 0 && (
                      <button
                        onClick={clearAllFilters}
                        className="text-sm text-red-600 dark:text-red-400 hover:underline"
                      >
                        Clear All
                      </button>
                    )}
                    
                    {/* Sort Dropdown */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-600 dark:text-slate-400">Sort by:</span>
                      <Select value={sortBy} onValueChange={setSortBy}>
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="status-priority">Status Priority</SelectItem>
                          <SelectItem value="checkin-soonest">Next Check-in: Soonest</SelectItem>
                          <SelectItem value="checkout-recent">Checkout: Most Recent</SelectItem>
                          <SelectItem value="checkout-oldest">Checkout: Oldest</SelectItem>
                          <SelectItem value="property-az">Property Name: A-Z</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {showFilters && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
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
            </FloatingWindow>
          )}

          {/* Timeline Window */}
          {showTimelineWindow && (
            <FloatingWindow
              id="timeline"
              title="Timeline View"
              defaultPosition={{ x: 150, y: 150 }}
              defaultSize={{ width: '70%', height: '80%' }}
              onClose={() => setShowTimelineWindow(false)}
            >
              <Timeline onCardClick={setSelectedCard} />
            </FloatingWindow>
          )}
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

      {/* Chat Popup for Natural Language Query */}
      <ChatPopup
        naturalQuery={naturalQuery}
        setNaturalQuery={setNaturalQuery}
        executeNaturalQuery={executeNaturalQuery}
        isExecutingQuery={isExecutingQuery}
        generatedSQL={generatedSQL}
      />
    </div>
  );
}

