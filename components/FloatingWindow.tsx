'use client';

import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { Button } from '@/components/ui/button';

interface FloatingWindowProps {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number | string; height: number | string };
  onClose: () => void;
  onMinimize?: () => void;
}

export default function FloatingWindow({
  id,
  title,
  children,
  defaultPosition = { x: 100, y: 100 },
  defaultSize = { width: '600px', height: '500px' },
  onClose,
  onMinimize
}: FloatingWindowProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  const handleMinimize = () => {
    setIsMinimized(!isMinimized);
    if (onMinimize) onMinimize();
  };

  return (
    <Rnd
      default={{
        ...defaultPosition,
        ...defaultSize
      }}
      minWidth={300}
      minHeight={200}
      bounds="parent"
      dragHandleClassName="drag-handle"
      className={`${isMinimized ? 'hidden' : ''}`}
      style={{
        zIndex: 10
      }}
    >
      <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl overflow-hidden">
        {/* Window Header */}
        <div className="drag-handle flex-shrink-0 flex items-center justify-between px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 cursor-move">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
          </div>
          
          <div className="flex gap-1">
            <Button
              onClick={handleMinimize}
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title="Minimize"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </Button>
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-red-100 dark:hover:bg-red-900"
              title="Close"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Window Content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </Rnd>
  );
}

