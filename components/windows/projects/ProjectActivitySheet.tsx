'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { ActivityLogEntry } from '@/lib/types';

interface ProjectActivitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activities: ActivityLogEntry[];
  loading: boolean;
}

export function ProjectActivitySheet({
  open,
  onOpenChange,
  activities,
  loading,
}: ProjectActivitySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[450px]">
        <SheetHeader>
          <SheetTitle>Activity History</SheetTitle>
          <SheetDescription>
            Recent changes and updates to this project
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 -mx-6 px-6 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading activity...</p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet</p>
          ) : (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                    {(activity.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{activity.user_name || 'Unknown'}</span>
                      {' '}
                      <span className="text-muted-foreground">{activity.action}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(activity.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

