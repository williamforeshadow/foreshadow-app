'use client';

import { useEffect, useState } from 'react';
import { useIsMobile } from '@/lib/useIsMobile';
import { createSupabaseClient } from '@/lib/supabaseAuth';
import DesktopApp from './desktop/DesktopApp';
import MobileApp from './mobile/MobileApp';

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const supabase = createSupabaseClient();
    
    // Check if user is authenticated
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          console.error('Session error:', error);
          window.location.href = '/login';
          return;
        }
        
        if (!session) {
          window.location.href = '/login';
        } else {
          setIsAuthenticated(true);
        }
      })
      .catch((err) => {
        console.error('Failed to get session:', err);
        window.location.href = '/login';
      });
  }, []); // Empty dependency array - run once on mount

  // Show loading while checking auth
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return isMobile ? <MobileApp /> : <DesktopApp />;
}
