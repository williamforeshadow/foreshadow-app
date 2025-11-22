'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ChatPopupProps {
  naturalQuery: string;
  setNaturalQuery: (value: string) => void;
  executeNaturalQuery: () => void;
  isExecutingQuery: boolean;
  generatedSQL: string;
}

export default function ChatPopup({
  naturalQuery,
  setNaturalQuery,
  executeNaturalQuery,
  isExecutingQuery,
  generatedSQL
}: ChatPopupProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-110"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat Popup */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-h-[600px] bg-white dark:bg-slate-900 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Natural Language Query
            </h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-4 flex-1 overflow-y-auto">
            <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded inline-block mb-3">
              💡 Tip: Start with <code className="text-purple-600 dark:text-purple-400">/cards</code> for card results
            </span>
            
            <div className="space-y-3">
              <textarea
                value={naturalQuery}
                onChange={(e) => setNaturalQuery(e.target.value)}
                placeholder="e.g., /cards show unassigned cleanings"
                rows={3}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
              />
              
              <Button
                onClick={() => {
                  executeNaturalQuery();
                  setIsOpen(false); // Auto-collapse after query
                }}
                disabled={isExecutingQuery || !naturalQuery}
                size="lg"
                className="w-full py-6 bg-purple-600 hover:bg-purple-700"
              >
                {isExecutingQuery ? '⚡ Generating & Running...' : '⚡ Run Query'}
              </Button>
              
              {generatedSQL && (
                <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Generated SQL:
                  </p>
                  <pre className="text-xs text-slate-900 dark:text-white font-mono overflow-x-auto whitespace-pre-wrap break-words">
                    {generatedSQL}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

