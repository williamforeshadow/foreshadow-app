'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface MobileQueryViewProps {
  onExecuteQuery: (query: string) => Promise<any>;
  onGenerateSQL: (naturalQuery: string) => Promise<string>;
}

export default function MobileQueryView({ onExecuteQuery, onGenerateSQL }: MobileQueryViewProps) {
  const [naturalQuery, setNaturalQuery] = useState('');
  const [generatedSQL, setGeneratedSQL] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateSQL = async () => {
    if (!naturalQuery.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    try {
      const sql = await onGenerateSQL(naturalQuery);
      setGeneratedSQL(sql);
    } catch (err: any) {
      setError(err.message || 'Failed to generate SQL');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecuteQuery = async () => {
    if (!generatedSQL.trim()) return;
    
    setIsExecuting(true);
    setError(null);
    try {
      const data = await onExecuteQuery(generatedSQL);
      setResults(data);
    } catch (err: any) {
      setError(err.message || 'Failed to execute query');
    } finally {
      setIsExecuting(false);
    }
  };

  const quickQueries = [
    { label: 'All Properties', query: 'Show me all properties' },
    { label: 'Today\'s Turnovers', query: 'What turnovers are scheduled for today?' },
    { label: 'Pending Cleanings', query: 'Show all cleanings that haven\'t started' },
    { label: 'Urgent Maintenance', query: 'List all urgent maintenance tasks' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Quick Queries */}
      <div className="sticky top-14 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Quick Queries</div>
        <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          {quickQueries.map((q, idx) => (
            <button
              key={idx}
              onClick={() => setNaturalQuery(q.query)}
              className="px-3 py-1.5 text-xs bg-neutral-100 dark:bg-neutral-800 rounded-full whitespace-nowrap border border-neutral-200 dark:border-neutral-700 active:bg-neutral-200 dark:active:bg-neutral-700"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Natural Language Input */}
        <div>
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 block">
            Ask in plain English
          </label>
          <textarea
            value={naturalQuery}
            onChange={(e) => setNaturalQuery(e.target.value)}
            placeholder="e.g., Show me all properties with pending cleanings..."
            className="w-full px-3 py-3 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 min-h-[80px] resize-none"
          />
          <Button
            onClick={handleGenerateSQL}
            disabled={!naturalQuery.trim() || isGenerating}
            className="w-full mt-2"
            size="sm"
          >
            {isGenerating ? 'Generating...' : 'Generate SQL'}
          </Button>
        </div>

        {/* Generated SQL */}
        {generatedSQL && (
          <div>
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 block">
              Generated SQL
            </label>
            <div className="bg-neutral-900 dark:bg-black rounded-lg p-3 overflow-x-auto">
              <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap">
                {generatedSQL}
              </pre>
            </div>
            <Button
              onClick={handleExecuteQuery}
              disabled={!generatedSQL.trim() || isExecuting}
              className="w-full mt-2"
              size="sm"
            >
              {isExecuting ? 'Executing...' : 'Execute Query'}
            </Button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Results
              </label>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {Array.isArray(results) ? `${results.length} rows` : '1 result'}
              </span>
            </div>
            <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-3 overflow-x-auto max-h-[300px] overflow-y-auto">
              {Array.isArray(results) && results.length > 0 ? (
                <div className="space-y-2">
                  {results.slice(0, 50).map((row, idx) => (
                    <div
                      key={idx}
                      className="bg-white dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 p-2 text-xs"
                    >
                      {Object.entries(row).map(([key, value]) => (
                        <div key={key} className="flex justify-between py-0.5">
                          <span className="text-neutral-500 dark:text-neutral-400">{key}:</span>
                          <span className="text-neutral-900 dark:text-white font-medium ml-2 truncate max-w-[60%]">
                            {String(value ?? 'null')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {results.length > 50 && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                      Showing first 50 of {results.length} results
                    </p>
                  )}
                </div>
              ) : (
                <pre className="text-xs text-neutral-600 dark:text-neutral-400 font-mono whitespace-pre-wrap">
                  {JSON.stringify(results, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

