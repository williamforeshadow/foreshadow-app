'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

export default function StaffPage() {
  const [staffName, setStaffName] = useState('');
  const [cleanings, setCleanings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');

  const fetchMyCleanings = async () => {
    if (!staffName.trim()) {
      setError('Please enter your name');
      return;
    }

    setLoading(true);
    setError(null);
    setCleanings(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('property_clean_status');

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item, index) => (
          <div
            key={item.cleaning_id || item.id || index}
            className={`rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow ${getCardBackgroundColor(item.property_clean_status)}`}
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
              {item.property_name || 'Unknown Property'}
            </h3>

            <div className="space-y-2 mb-3">
              {item.check_out && (
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Checked out</div>
                    <div className="text-sm text-slate-900 dark:text-white">{formatDate(item.check_out)}</div>
                  </div>
                </div>
              )}

              {item.next_check_in && (
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-green-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Next check in</div>
                    <div className="text-sm text-slate-900 dark:text-white">{formatDate(item.next_check_in)}</div>
                  </div>
                </div>
              )}

              {item.scheduled_start && (
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Scheduled</div>
                    <div className="text-sm text-slate-900 dark:text-white">{formatDate(item.scheduled_start)}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {item.property_clean_status && (
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  item.property_clean_status === 'needs_cleaning' 
                    ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                    : item.property_clean_status === 'cleaning_scheduled'
                    ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                    : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
                }`}>
                  {item.property_clean_status === 'needs_cleaning' ? '🔴 Needs Cleaning' :
                   item.property_clean_status === 'cleaning_scheduled' ? '🟡 Scheduled' :
                   '🟢 Complete'}
                </span>
              )}
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                👤 {item.assigned_staff || 'Unassigned'}
              </span>
            </div>
          </div>
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
            <button
              onClick={fetchMyCleanings}
              disabled={loading}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors text-lg"
            >
              {loading ? 'Loading...' : 'View My Cleanings'}
            </button>
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
    </div>
  );
}

