'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OpenAI from 'openai';

export default function Home() {
  const [functionName, setFunctionName] = useState('');
  const [params, setParams] = useState('{}');
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const callRPC = async (rpcName?: string, rpcParams?: any) => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      // Use provided params or parse from input
      const parsedParams = rpcParams !== undefined ? rpcParams : JSON.parse(params);
      const funcName = rpcName || functionName;

      // Call the Supabase RPC function
      const { data, error: rpcError } = await supabase.rpc(funcName, parsedParams);

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

  const quickCall = (rpcName: string) => {
    setFunctionName(rpcName);
    setParams('{}');
    callRPC(rpcName, {});
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item, index) => (
          <div
            key={item.cleaning_id || item.id || index}
            className={`rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow ${getCardBackgroundColor(item.property_clean_status)}`}
          >
            {/* Property Name */}
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
              {item.property_name || item.name || 'Unknown Property'}
            </h3>

            {/* Dates */}
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

            {/* Status and Assignment */}
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
              {item.assigned_staff ? (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                  👤 {item.assigned_staff}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                  Unassigned
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold mb-8 text-slate-900 dark:text-white text-center">
          Supabase RPC Caller
        </h1>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800 space-y-4">
          {/* Function Name Input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Function Name
            </label>
            <input
              type="text"
              value={functionName}
              onChange={(e) => setFunctionName(e.target.value)}
              placeholder="e.g., my_function"
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Parameters Input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Parameters (JSON)
            </label>
            <textarea
              value={params}
              onChange={(e) => setParams(e.target.value)}
              placeholder='{"param1": "value1", "param2": "value2"}'
              rows={4}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Call Button */}
          <button
            onClick={() => callRPC()}
            disabled={loading || !functionName}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Calling...' : 'Call RPC Function'}
          </button>

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-medium text-red-800 dark:text-red-400">Error:</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          )}

          {/* Response Display */}
          {response !== null && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Response: {Array.isArray(response) ? `${response.length} item(s)` : '1 item'}
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

        {/* Quick Access Button */}
        <div className="mt-8">
          <button
            onClick={() => quickCall('property_clean_status')}
            disabled={loading}
            className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold text-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
          >
            Property Status
          </button>
        </div>
      </div>
    </div>
  );
}

