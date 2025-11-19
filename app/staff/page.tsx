'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function StaffPage() {
  const [staffName, setStaffName] = useState('');
  const [cleanings, setCleanings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [updatingCardAction, setUpdatingCardAction] = useState(false);

  const fetchMyCleanings = async () => {
    if (!staffName.trim()) {
      setError('Please enter your name');
      return;
    }

    setLoading(true);
    setError(null);
    setCleanings(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_property_turnovers');

      if (rpcError) {
        setError(rpcError.message);
      } else {
        // Filter cleanings for this staff member
        const myCleanings = data?.filter((cleaning: any) => 
          cleaning.assigned_staff?.toLowerCase().includes(staffName.toLowerCase())
        ) || [];
        
        if (myCleanings.length === 0) {
          setError(`No cleanings found for "${staffName}". Check your name spelling.`);
        } else {
          setCleanings(myCleanings);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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

      // Refresh the cleanings
      await fetchMyCleanings();
      setSelectedCard(null);
    } catch (err: any) {
      setError(err.message || 'Failed to update card action');
    } finally {
      setUpdatingCardAction(false);
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
        return 1;
      case 'cleaning_scheduled':
        return 2;
      case 'cleaning_complete':
        return 3;
      default:
        return 4;
    }
  };

  const renderCards = () => {
    if (!cleanings) return null;
    
    let items = [...cleanings].sort((a, b) => {
      const priorityA = getSortPriority(a.property_clean_status);
      const priorityB = getSortPriority(b.property_clean_status);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      const dateA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
      const dateB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
      
      return dateA - dateB;
    });

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                    {item.card_actions === 'not_started' ? '🎬 Not Started' :
                     item.card_actions === 'in_progress' ? '▶️ In Progress' :
                     item.card_actions === 'paused' ? '⏸️ Paused' :
                     item.card_actions === 'completed' ? '✅ Completed' :
                     '🎬 Not Started'}
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
                {item.property_clean_status === 'needs_cleaning' ? '🔴 Needs Cleaning' :
                 item.property_clean_status === 'cleaning_scheduled' ? '🟡 Scheduled' :
                 item.property_clean_status === 'cleaning_complete' ? '🟢 Complete' :
                 '⚪ Unknown'}
              </Badge>
              
              <Badge variant={item.assigned_staff ? 'default' : 'outline'}>
                {item.assigned_staff ? `👤 ${item.assigned_staff}` : 'Unassigned'}
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
          Staff Portal
        </h1>

        {/* Name Input */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800 mb-8">
          <label className="block text-lg font-medium text-slate-700 dark:text-slate-300 mb-4">
            What is your name?
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && fetchMyCleanings()}
              placeholder="Enter your name"
              className="flex-1 px-4 py-3 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />
            <Button
              onClick={fetchMyCleanings}
              disabled={loading}
              size="lg"
              className="px-8 text-lg"
            >
              {loading ? 'Loading...' : 'View My Cleanings'}
            </Button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-8">
            <p className="text-sm font-medium text-red-800 dark:text-red-400">Error:</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
          </div>
        )}

        {/* Results */}
        {cleanings !== null && (
          <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                Your Cleanings ({cleanings.length})
              </h2>
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
                    {JSON.stringify(cleanings, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Card Detail Modal */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent 
          className={`max-w-lg max-h-[90vh] overflow-y-auto border-2 ${
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
                  {selectedCard.property_clean_status === 'needs_cleaning' ? '🔴 Needs Cleaning' :
                   selectedCard.property_clean_status === 'cleaning_scheduled' ? '🟡 Scheduled' :
                   selectedCard.property_clean_status === 'cleaning_complete' ? '🟢 Complete' :
                   '⚪ Unknown'}
                </Badge>
                
                <Badge variant={selectedCard.assigned_staff ? 'default' : 'outline'} className="text-sm py-1.5">
                  {selectedCard.assigned_staff ? `👤 ${selectedCard.assigned_staff}` : 'Unassigned'}
                </Badge>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-200 dark:border-slate-800 my-4"></div>

              {/* Current Action Status */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Current Action</div>
                <div className={`text-base font-semibold flex items-center gap-2 ${
                  selectedCard.card_actions === 'in_progress' ? 'text-blue-600 dark:text-blue-400' :
                  selectedCard.card_actions === 'paused' ? 'text-orange-600 dark:text-orange-400' :
                  selectedCard.card_actions === 'completed' ? 'text-green-600 dark:text-green-400' :
                  'text-slate-600 dark:text-slate-400'
                }`}>
                  {selectedCard.card_actions === 'not_started' ? '🎬 Not Started' :
                   selectedCard.card_actions === 'in_progress' ? '▶️ In Progress' :
                   selectedCard.card_actions === 'paused' ? '⏸️ Paused' :
                   selectedCard.card_actions === 'completed' ? '✅ Completed' :
                   '🎬 Not Started'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 mt-4">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Change Action:</div>
                {getAvailableActions(selectedCard.card_actions).map((action) => (
                  <Button
                    key={action.value}
                    onClick={() => updateCardAction(selectedCard.id, action.value)}
                    disabled={updatingCardAction}
                    size="lg"
                    className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400"
                  >
                    <span className="text-xl mr-2">{action.icon}</span>
                    <span>{action.label}</span>
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

