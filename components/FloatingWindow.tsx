'use client';

import { useState, memo } from 'react';
import { Rnd } from 'react-rnd';
import { Button } from '@/components/ui/button';

interface FloatingWindowProps {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number | string; height: number | string };
  zIndex?: number;
  onClose: () => void;
  onFocus?: () => void;
}

const FloatingWindow = memo(function FloatingWindow({
  id,
  title,
  children,
  defaultPosition = { x: 100, y: 100 },
  defaultSize = { width: '600px', height: '500px' },
  zIndex = 10,
  onClose,
  onFocus
}: FloatingWindowProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedPosition, setSavedPosition] = useState(defaultPosition);
  const [savedSize, setSavedSize] = useState(defaultSize);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <Rnd
      key={`${id}-${isFullscreen ? 'full' : 'normal'}`}
      default={{
        x: isFullscreen ? 0 : savedPosition.x,
        y: isFullscreen ? 0 : savedPosition.y,
        width: isFullscreen ? '100%' : savedSize.width,
        height: isFullscreen ? '100%' : savedSize.height
      }}
      onDragStop={(e, d) => {
        if (!isFullscreen) {
          setSavedPosition({ x: d.x, y: d.y });
        }
        onFocus?.();
      }}
      onResizeStop={(e, direction, ref, delta, position) => {
        if (!isFullscreen) {
          setSavedSize({
            width: ref.style.width,
            height: ref.style.height
          });
          setSavedPosition(position);
        }
      }}
      minWidth={300}
      minHeight={200}
      bounds="parent"
      dragHandleClassName="drag-handle"
      disableDragging={isFullscreen}
      enableResizing={!isFullscreen}
      style={{
        zIndex
      }}
    >
      <div 
        className="h-full flex flex-col bg-white dark:bg-neutral-900 border-2 border-neutral-300 dark:border-neutral-700 rounded-lg shadow-2xl overflow-hidden"
        onClick={onFocus}
      >
        {/* Window Header */}
        <div className="drag-handle flex-shrink-0 flex items-center justify-between px-4 py-2 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 cursor-move">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
            <span className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</span>
          </div>
          
          <div className="flex gap-1">
            <Button
              onClick={toggleFullscreen}
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title={isFullscreen ? "Restore" : "Fullscreen"}
            >
              {isFullscreen ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
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
}, (prevProps, nextProps) => {
  // Only re-render if these props actually changed
  // Return true if props are equal (skip re-render)
  // Return false if props changed (do re-render)
  return (
    prevProps.id === nextProps.id &&
    prevProps.title === nextProps.title &&
    prevProps.zIndex === nextProps.zIndex &&
    prevProps.children === nextProps.children &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onFocus === nextProps.onFocus
  );
});

export default FloatingWindow;
