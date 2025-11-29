'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OpenAI from 'openai';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Timeline from '@/components/Timeline';
import FloatingWindow from '@/components/FloatingWindow';
import CleaningForm from '@/components/CleaningForm';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import CleaningCards from '@/components/CleaningCards';
import MaintenanceCards from '@/components/MaintenanceCards';

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
  const [currentTemplate, setCurrentTemplate] = useState<any>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [allTemplates, setAllTemplates] = useState<any[]>([]);
  const [allProperties, setAllProperties] = useState<string[]>([]);
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
  const [maintenanceFilters, setMaintenanceFilters] = useState({
    priority: [] as string[],
    cardActions: [] as string[],
    staff: [] as string[],
    property: [] as string[]
  });
  const [maintenanceSortBy, setMaintenanceSortBy] = useState('priority-high');
  const [showCardsWindow, setShowCardsWindow] = useState(true);
  const [showTimelineWindow, setShowTimelineWindow] = useState(true);
  const [showQueryWindow, setShowQueryWindow] = useState(false);
  const [activeWindow, setActiveWindow] = useState<'cards' | 'timeline' | 'query'>('cards');
  const [windowOrder, setWindowOrder] = useState<Array<'cards' | 'timeline' | 'query'>>(['cards', 'timeline', 'query']);
  const [showCleaningForm, setShowCleaningForm] = useState(false);
  const [cardViewMode, setCardViewMode] = useState<'cleanings' | 'maintenance'>('cleanings');
  const [maintenanceCards, setMaintenanceCards] = useState<any[]>([]);
  const [showCreateMaintenance, setShowCreateMaintenance] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    property_name: 'none',
    title: '',
    description: '',
    assigned_staff: '',
    scheduled_start: '',
    priority: 'medium'
  });
  const [creatingMaintenance, setCreatingMaintenance] = useState(false);

  // Window stacking order management
  const bringToFront = (window: 'cards' | 'timeline' | 'query') => {
    setActiveWindow(window);
    setWindowOrder(prev => {
      const filtered = prev.filter(w => w !== window);
      return [...filtered, window]; // Move window to end (top of stack)
    });
  };

  const getZIndex = (window: 'cards' | 'timeline' | 'query') => {
    const position = windowOrder.indexOf(window);
    return 10 + position; // Base 10, then 11, 12 based on stack position
  };

  // Auto-load data on mount
  useEffect(() => {
    quickCall('get_property_turnovers');
    fetchAllTemplates();
    fetchAllProperties();
  }, []);

  const fetchAllTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.templates) {
        setAllTemplates(data.templates);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  const fetchAllProperties = async () => {
    try {
      const res = await fetch('/api/properties');
      const data = await res.json();
      if (data.properties) {
        setAllProperties(data.properties);
      }
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  };

  // Fetch template when card is selected
  useEffect(() => {
    const fetchTemplate = async () => {
      if (selectedCard?.template_id) {
        setLoadingTemplate(true);
        try {
          const res = await fetch(`/api/templates/${selectedCard.template_id}`);
          const data = await res.json();
          if (data.template) {
            setCurrentTemplate(data.template);
          }
        } catch (err) {
          console.error('Error fetching template:', err);
          setCurrentTemplate(null);
        } finally {
          setLoadingTemplate(false);
        }
      } else {
        setCurrentTemplate(null);
      }
    };

    fetchTemplate();
  }, [selectedCard?.template_id]);

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

  const fetchMaintenanceCards = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_maintenance_cards');
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setMaintenanceCards(data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch maintenance cards');
    } finally {
      setLoading(false);
    }
  };

  const createMaintenance = async () => {
    if (!maintenanceForm.title.trim()) {
      setError('Title is required');
      return;
    }

    setCreatingMaintenance(true);
    setError(null);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...maintenanceForm,
          property_name: maintenanceForm.property_name === 'none' ? null : maintenanceForm.property_name
        })
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        // Refresh maintenance cards
        await fetchMaintenanceCards();
        // Reset form and close dialog
        setMaintenanceForm({
          property_name: 'none',
          title: '',
          description: '',
          assigned_staff: '',
          scheduled_start: '',
          priority: 'medium'
        });
        setShowCreateMaintenance(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create maintenance card');
    } finally {
      setCreatingMaintenance(false);
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

  const updateMaintenanceAction = async (maintenanceId: string, newAction: string) => {
    setUpdatingCardAction(true);
    try {
      const response = await fetch('/api/update-maintenance-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenanceId, action: newAction })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update maintenance action');
      }

      // Update the local state
      const updatedCard = result.data;
      
      setMaintenanceCards((prevCards: any[]) => 
        prevCards.map((card: any) => 
          card.id === maintenanceId 
            ? { ...card, ...updatedCard }
            : card
        )
      );

      // Also update the selected card if still open
      setSelectedCard((prev: any) => 
        prev?.id === maintenanceId 
          ? { ...prev, ...updatedCard }
          : prev
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update maintenance action');
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

  const saveCleaningForm = async (cleaningId: string, formData: any) => {
    try {
      const response = await fetch('/api/save-cleaning-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaningId, formData })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save form');
      }

      return result;
    } catch (err: any) {
      console.error('Error saving form:', err);
      setError(err.message || 'Failed to save form');
      throw err;
    }
  };

  const openCleaningForm = async () => {
    // If card has a template_id from property default but not saved to cleanings table yet, save it
    if (selectedCard && selectedCard.template_id) {
      try {
        await fetch('/api/update-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cleaningId: selectedCard.id,
            templateId: selectedCard.template_id
          })
        });
      } catch (err) {
        console.error('Error saving template to cleaning:', err);
      }
    }
    setShowCleaningForm(true);
  };

  const changeTemplate = async (templateId: string | null) => {
    if (!selectedCard) return;
    
    try {
      await fetch('/api/update-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaningId: selectedCard.id,
          templateId
        })
      });

      // Update local state
      setSelectedCard({ ...selectedCard, template_id: templateId });
      
      // Refresh to fetch new template
      if (templateId) {
        const res = await fetch(`/api/templates/${templateId}`);
        const data = await res.json();
        if (data.template) {
          setCurrentTemplate(data.template);
        }
      } else {
        setCurrentTemplate(null);
      }
    } catch (err) {
      console.error('Error changing template:', err);
      alert('Failed to change template');
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

  const toggleMaintenanceFilter = (category: keyof typeof maintenanceFilters, value: string) => {
    setMaintenanceFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value]
    }));
  };

  const clearAllFilters = () => {
    if (cardViewMode === 'cleanings') {
      setFilters({
        cleanStatus: [],
        cardActions: [],
        staff: []
      });
    } else {
      setMaintenanceFilters({
        priority: [],
        cardActions: [],
        staff: [],
        property: []
      });
    }
  };

  const getUniqueStaff = (items: any[]) => {
    const staff = items
      .map(item => item.assigned_staff)
      .filter(s => s !== null && s !== undefined);
    return Array.from(new Set(staff)).sort();
  };

  const getActiveFilterCount = () => {
    return cardViewMode === 'cleanings'
      ? filters.cleanStatus.length + filters.cardActions.length + filters.staff.length
      : maintenanceFilters.priority.length + maintenanceFilters.cardActions.length + maintenanceFilters.staff.length + maintenanceFilters.property.length;
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

  const renderCardsSection = () => {
    if (cardViewMode === 'cleanings') {
      const cleaningsData = response ? (Array.isArray(response) ? response : [response]) : [];
      return (
        <CleaningCards
          data={cleaningsData}
          filters={filters}
          sortBy={sortBy}
          onCardClick={setSelectedCard}
        />
      );
    } else {
      return (
        <MaintenanceCards
          data={maintenanceCards}
          filters={maintenanceFilters}
          sortBy={maintenanceSortBy}
          onCardClick={setSelectedCard}
        />
      );
    }
  };

  // Memoize window contents to prevent re-renders when only z-index changes
  const cardsWindowContent = useMemo(() => (
    <div className="p-6 space-y-4">
      {/* Card Type Toggle */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant={cardViewMode === 'cleanings' ? 'default' : 'outline'}
          onClick={() => {
            setCardViewMode('cleanings');
            if (!response) {
              quickCall('get_property_turnovers');
            }
          }}
          size="sm"
        >
          Cleanings
        </Button>
        <Button
          variant={cardViewMode === 'maintenance' ? 'default' : 'outline'}
          onClick={() => {
            setCardViewMode('maintenance');
            fetchMaintenanceCards();
          }}
          size="sm"
        >
          Maintenance
        </Button>
        
        {/* Create Maintenance Button - only show in maintenance mode */}
        {cardViewMode === 'maintenance' && (
          <Button
            onClick={() => setShowCreateMaintenance(true)}
            size="sm"
            className="ml-auto"
          >
            + Create Maintenance
          </Button>
        )}
      </div>

      {/* Response Display */}
      {((cardViewMode === 'cleanings' && response !== null) || (cardViewMode === 'maintenance' && maintenanceCards.length > 0)) && (
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
                  {cardViewMode === 'cleanings' ? (
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
                  ) : (
                    <Select value={maintenanceSortBy} onValueChange={setMaintenanceSortBy}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority-high">Priority: High First</SelectItem>
                        <SelectItem value="status-priority">Status Priority</SelectItem>
                        <SelectItem value="scheduled-soonest">Scheduled: Soonest</SelectItem>
                        <SelectItem value="created-newest">Created: Newest</SelectItem>
                        <SelectItem value="created-oldest">Created: Oldest</SelectItem>
                        <SelectItem value="property-az">Property Name: A-Z</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                {/* Clean Status - Only for cleanings */}
                {cardViewMode === 'cleanings' && (
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
                )}

                {/* Priority - Only for maintenance */}
                {cardViewMode === 'maintenance' && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Priority</h4>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('urgent')}
                          onChange={() => toggleMaintenanceFilter('priority', 'urgent')}
                          className="rounded border-slate-300"
                        />
                        <span>Urgent</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('high')}
                          onChange={() => toggleMaintenanceFilter('priority', 'high')}
                          className="rounded border-slate-300"
                        />
                        <span>High</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('medium')}
                          onChange={() => toggleMaintenanceFilter('priority', 'medium')}
                          className="rounded border-slate-300"
                        />
                        <span>Medium</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.priority.includes('low')}
                          onChange={() => toggleMaintenanceFilter('priority', 'low')}
                          className="rounded border-slate-300"
                        />
                        <span>Low</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Card Actions */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Card Actions</h4>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('not_started') : maintenanceFilters.cardActions.includes('not_started')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'not_started') : toggleMaintenanceFilter('cardActions', 'not_started')}
                        className="rounded border-slate-300"
                      />
                      <span>Not Started</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('in_progress') : maintenanceFilters.cardActions.includes('in_progress')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'in_progress') : toggleMaintenanceFilter('cardActions', 'in_progress')}
                        className="rounded border-slate-300"
                      />
                      <span>In Progress</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('paused') : maintenanceFilters.cardActions.includes('paused')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'paused') : toggleMaintenanceFilter('cardActions', 'paused')}
                        className="rounded border-slate-300"
                      />
                      <span>Paused</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cardViewMode === 'cleanings' ? filters.cardActions.includes('completed') : maintenanceFilters.cardActions.includes('completed')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('cardActions', 'completed') : toggleMaintenanceFilter('cardActions', 'completed')}
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
                        checked={cardViewMode === 'cleanings' ? filters.staff.includes('unassigned') : maintenanceFilters.staff.includes('unassigned')}
                        onChange={() => cardViewMode === 'cleanings' ? toggleFilter('staff', 'unassigned') : toggleMaintenanceFilter('staff', 'unassigned')}
                        className="rounded border-slate-300"
                      />
                      <span>Unassigned</span>
                    </label>
                    {cardViewMode === 'cleanings' && response && getUniqueStaff(Array.isArray(response) ? response : [response]).map(staff => (
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
                    {cardViewMode === 'maintenance' && maintenanceCards && getUniqueStaff(maintenanceCards).map(staff => (
                      <label key={staff} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintenanceFilters.staff.includes(staff)}
                          onChange={() => toggleMaintenanceFilter('staff', staff)}
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
              {cardViewMode === 'cleanings' ? (
                <>Cleanings: {Array.isArray(response) ? response.length : 1} total</>
              ) : (
                <>Maintenance: {maintenanceCards.length} total</>
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

          <div>
            {viewMode === 'cards' ? (
              <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
                {renderCardsSection()}
              </div>
            ) : (
              <div className="p-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                <pre className="text-sm text-slate-900 dark:text-slate-100 font-mono whitespace-pre-wrap">
                  {JSON.stringify(cardViewMode === 'cleanings' ? response : maintenanceCards, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  ), [response, viewMode, showFilters, filters, sortBy, cardViewMode, maintenanceCards, maintenanceFilters, maintenanceSortBy]);

  const timelineWindowContent = useMemo(() => (
    <Timeline onCardClick={setSelectedCard} />
  ), []);

  const queryWindowContent = useMemo(() => (
    <div className="p-6 space-y-4">
      {/* Natural Language Query Section */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          Natural Language Query
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={naturalQuery}
            onChange={(e) => setNaturalQuery(e.target.value)}
            placeholder="e.g., show me all cleanings for next week"
            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            onKeyDown={(e) => e.key === 'Enter' && executeNaturalQuery()}
          />
          <Button
            onClick={executeNaturalQuery}
            disabled={isExecutingQuery || !naturalQuery.trim()}
          >
            {isExecutingQuery ? 'Executing...' : 'Execute'}
          </Button>
        </div>
        
        {generatedSQL && (
          <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Generated SQL:</p>
            <pre className="text-xs text-slate-900 dark:text-white font-mono overflow-x-auto">
              {generatedSQL}
            </pre>
          </div>
        )}
      </div>

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
  ), [naturalQuery, isExecutingQuery, generatedSQL, response, aiSummary, isGeneratingSummary, isSpeaking]);

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
                onClick={() => {
                  if (showCardsWindow) {
                    setShowCardsWindow(false);
                  } else {
                    setShowCardsWindow(true);
                    bringToFront('cards');
                  }
                }}
                variant={showCardsWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Cards
              </Button>
              <Button
                onClick={() => {
                  if (showTimelineWindow) {
                    setShowTimelineWindow(false);
                  } else {
                    setShowTimelineWindow(true);
                    bringToFront('timeline');
                  }
                }}
                variant={showTimelineWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Timeline
              </Button>
              <Button
                onClick={() => {
                  if (showQueryWindow) {
                    setShowQueryWindow(false);
                  } else {
                    setShowQueryWindow(true);
                    bringToFront('query');
                  }
                }}
                variant={showQueryWindow ? 'default' : 'outline'}
                size="sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Query
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
        <div className="flex-1 relative overflow-hidden bg-slate-700 dark:bg-slate-800">
          {/* Cards Window */}
          {showCardsWindow && (
            <FloatingWindow
              id="cards"
              title="Cards View"
              defaultPosition={{ x: 50, y: 50 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('cards')}
              onClose={() => setShowCardsWindow(false)}
              onFocus={() => bringToFront('cards')}
            >
              {cardsWindowContent}
            </FloatingWindow>
          )}

          {/* Timeline Window */}
          {showTimelineWindow && (
            <FloatingWindow
              id="timeline"
              title="Timeline View"
              defaultPosition={{ x: 150, y: 150 }}
              defaultSize={{ width: '70%', height: '80%' }}
              zIndex={getZIndex('timeline')}
              onClose={() => setShowTimelineWindow(false)}
              onFocus={() => bringToFront('timeline')}
            >
              {timelineWindowContent}
            </FloatingWindow>
          )}

          {/* Query Window */}
          {showQueryWindow && (
            <FloatingWindow
              id="query"
              title="Natural Language Query"
              defaultPosition={{ x: 250, y: 250 }}
              defaultSize={{ width: '60%', height: '70%' }}
              zIndex={getZIndex('query')}
              onClose={() => setShowQueryWindow(false)}
              onFocus={() => bringToFront('query')}
            >
              {queryWindowContent}
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
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <DialogTitle className="text-2xl">
                      {selectedCard.title || selectedCard.property_name || 'Unknown'}
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2 text-base">
                      {/* Show guest name for cleanings, description for maintenance */}
                      {selectedCard.guest_name ? (
                        <>
                          <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {selectedCard.guest_name}
                        </>
                      ) : (
                        <span className="text-slate-600 dark:text-slate-400">
                          {selectedCard.description || 'No description'}
                        </span>
                      )}
                    </DialogDescription>
                  </div>
                  
                  {/* Form Icon Button - only show for cleanings when not viewing form */}
                  {!showCleaningForm && selectedCard.guest_name && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={openCleaningForm}
                      className="shrink-0 h-8 w-8 p-0"
                      title="Open Cleaning Form"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                      </svg>
                    </Button>
                  )}
                </div>
              </DialogHeader>

              {/* Template Selector - Only show for cleanings when NOT in form view */}
              {!showCleaningForm && selectedCard.guest_name && allTemplates.length > 0 && (
                <div className="px-6 pb-4 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Template:
                    </label>
                    <Select
                      value={selectedCard.template_id || 'none'}
                      onValueChange={(value) => changeTemplate(value === 'none' ? null : value)}
                    >
                      <SelectTrigger className="w-64">
                        <SelectValue placeholder="Select template..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-slate-500">No template</span>
                        </SelectItem>
                        {allTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {showCleaningForm ? (
                loadingTemplate ? (
                  <div className="flex items-center justify-center py-12">
                    <p className="text-slate-500">Loading form template...</p>
                  </div>
                ) : currentTemplate ? (
                  <DynamicCleaningForm
                    cleaningId={selectedCard.id}
                    propertyName={selectedCard.property_name}
                    template={currentTemplate}
                    formMetadata={selectedCard.form_metadata}
                    currentAction={selectedCard.card_actions}
                    availableActions={getAvailableActions(selectedCard.card_actions)}
                    onSave={async (formData) => {
                      await saveCleaningForm(selectedCard.id, formData);
                      setSelectedCard({...selectedCard, form_metadata: formData});
                      setShowCleaningForm(false);
                    }}
                    onActionChange={async (action) => {
                      await updateCardAction(selectedCard.id, action);
                    }}
                    onCancel={() => setShowCleaningForm(false)}
                  />
                ) : (
                  <CleaningForm
                    cleaningId={selectedCard.id}
                    propertyName={selectedCard.property_name}
                    formMetadata={selectedCard.form_metadata}
                    currentAction={selectedCard.card_actions}
                    availableActions={getAvailableActions(selectedCard.card_actions)}
                    onSave={async (formData) => {
                      await saveCleaningForm(selectedCard.id, formData);
                      setSelectedCard({...selectedCard, form_metadata: formData});
                      setShowCleaningForm(false);
                    }}
                    onActionChange={async (action) => {
                      await updateCardAction(selectedCard.id, action);
                    }}
                    onCancel={() => setShowCleaningForm(false)}
                  />
                )
              ) : (
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

                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <svg className={`w-5 h-5 shrink-0 ${
                    selectedCard.occupancy_status === 'occupied' ? 'text-orange-500' : 
                    selectedCard.occupancy_status === 'general' ? 'text-slate-400' : 
                    'text-slate-400'
                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Occupancy</div>
                    <Badge 
                      variant={selectedCard.occupancy_status === 'occupied' ? 'default' : 'outline'}
                      className={`text-sm ${
                        selectedCard.occupancy_status === 'occupied' 
                          ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                          : selectedCard.occupancy_status === 'general'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300'
                      }`}
                    >
                      {selectedCard.occupancy_status === 'occupied' ? 'Occupied' : 
                       selectedCard.occupancy_status === 'general' ? 'General' : 
                       'Vacant'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2 pt-2">
                {/* Show clean status for cleanings, priority for maintenance */}
                {selectedCard.guest_name ? (
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
                ) : (
                  <Badge
                    variant={
                      selectedCard.priority === 'urgent' ? 'destructive' :
                      selectedCard.priority === 'high' ? 'default' : 'secondary'
                    }
                    className={`text-sm py-1.5 capitalize ${
                      selectedCard.priority === 'urgent' 
                        ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300'
                        : selectedCard.priority === 'high'
                        ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300'
                        : selectedCard.priority === 'low'
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300'
                        : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300'
                    }`}
                  >
                    {selectedCard.priority || 'Medium'} Priority
                  </Badge>
                )}
                
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

            </div>
              )}

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

      {/* Create Maintenance Dialog */}
      <Dialog open={showCreateMaintenance} onOpenChange={setShowCreateMaintenance}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Maintenance Card</DialogTitle>
            <DialogDescription>
              Create a new maintenance task for a property or general item.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Property */}
            <div>
              <label className="block text-sm font-medium mb-2">Property (Optional)</label>
              <Select
                value={maintenanceForm.property_name}
                onValueChange={(value) => setMaintenanceForm({...maintenanceForm, property_name: value})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select property or leave blank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (General)</SelectItem>
                  {allProperties.map((property) => (
                    <SelectItem key={property} value={property}>
                      {property}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium mb-2">Title *</label>
              <input
                type="text"
                value={maintenanceForm.title}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, title: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                placeholder="e.g., Fix leaky faucet"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={maintenanceForm.description}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, description: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white min-h-[80px]"
                placeholder="Additional details..."
              />
            </div>

            {/* Assigned Staff */}
            <div>
              <label className="block text-sm font-medium mb-2">Assigned Staff</label>
              <input
                type="text"
                value={maintenanceForm.assigned_staff}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, assigned_staff: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                placeholder="Staff member name"
              />
            </div>

            {/* Scheduled Start */}
            <div>
              <label className="block text-sm font-medium mb-2">Scheduled Start</label>
              <input
                type="datetime-local"
                value={maintenanceForm.scheduled_start}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, scheduled_start: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium mb-2">Priority</label>
              <Select
                value={maintenanceForm.priority}
                onValueChange={(value) => setMaintenanceForm({...maintenanceForm, priority: value})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateMaintenance(false)}
              disabled={creatingMaintenance}
            >
              Cancel
            </Button>
            <Button
              onClick={createMaintenance}
              disabled={creatingMaintenance}
            >
              {creatingMaintenance ? 'Creating...' : 'Create Maintenance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

