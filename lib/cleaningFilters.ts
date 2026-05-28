export interface CleaningFilters {
  turnoverStatus: string[];
  occupancyStatus: string[];
  timeline: string[];  // 'active' | 'upcoming'
  // Property name multi-select. Empty = no property filter.
  properties: string[];
  // Free-text guest-name search (case-insensitive substring match). Empty
  // string = no search filter applied.
  search: string;
}

export function applyCleaningFilters(items: any[], filters: CleaningFilters): any[] {
  const searchLower = filters.search.trim().toLowerCase();
  return items.filter(item => {
    // Turnover Status filter
    if (filters.turnoverStatus.length > 0) {
      if (!filters.turnoverStatus.includes(item.turnover_status || 'no_tasks')) {
        return false;
      }
    }

    // Occupancy Status filter. Only reservations whose check-in has already
    // happened can have a real occupancy state — upcoming reservations are
    // neither "occupied" nor "checked out" (the guest hasn't arrived yet),
    // so they're excluded whenever an occupancy filter is active.
    if (filters.occupancyStatus.length > 0) {
      const checkIn = item.check_in ? new Date(item.check_in) : null;
      const hasCheckedIn = !!checkIn && new Date() >= checkIn;
      if (!hasCheckedIn) return false;

      const status = item.occupancy_status === 'occupied' ? 'occupied' : 'vacant';
      if (!filters.occupancyStatus.includes(status)) {
        return false;
      }
    }

    // Property filter
    if (filters.properties.length > 0) {
      if (!filters.properties.includes(item.property_name || '')) {
        return false;
      }
    }

    // Guest-name search
    if (searchLower) {
      const guest = (item.guest_name || '').toLowerCase();
      if (!guest.includes(searchLower)) {
        return false;
      }
    }

    return true;
  });
}

export function sortCleanings(items: any[], sortBy: string): any[] {
  const now = new Date().getTime();
  
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'status-priority':
        // Sort by turnover_status priority (red, yellow, green), then by next_check_in
        const priorityA = getSortPriority(a.turnover_status);
        const priorityB = getSortPriority(b.turnover_status);
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        
        // If same status, sort by next_check_in (future dates first, soonest to latest)
        const dateA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
        const dateB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
        
        // Treat past dates as farther in the future (push to bottom)
        const futureA = dateA < now ? Infinity : dateA;
        const futureB = dateB < now ? Infinity : dateB;
        
        return futureA - futureB;
        
      case 'checkin-soonest':
        // Next check-in: Soonest (future dates first, then past dates)
        const checkinA = a.next_check_in ? new Date(a.next_check_in).getTime() : Infinity;
        const checkinB = b.next_check_in ? new Date(b.next_check_in).getTime() : Infinity;
        
        const futureCheckinA = checkinA < now ? Infinity : checkinA;
        const futureCheckinB = checkinB < now ? Infinity : checkinB;
        
        return futureCheckinA - futureCheckinB;
        
      case 'checkout-recent':
        // Checkout: Most Recent (recent first, accounting for current date)
        const checkoutA = a.check_out ? new Date(a.check_out).getTime() : -Infinity;
        const checkoutB = b.check_out ? new Date(b.check_out).getTime() : -Infinity;
        
        // Prioritize future/recent dates
        const recentA = checkoutA < now ? checkoutA : checkoutA + 1000000000000;
        const recentB = checkoutB < now ? checkoutB : checkoutB + 1000000000000;
        
        return recentB - recentA; // Descending
        
      case 'checkout-oldest':
        // Checkout: Oldest First
        const oldCheckoutA = a.check_out ? new Date(a.check_out).getTime() : Infinity;
        const oldCheckoutB = b.check_out ? new Date(b.check_out).getTime() : Infinity;
        return oldCheckoutA - oldCheckoutB;
        
      case 'property-az':
        // Property Name: A-Z
        const nameA = a.property_name || '';
        const nameB = b.property_name || '';
        return nameA.localeCompare(nameB);
        
      default:
        return 0;
    }
  });
}

function getSortPriority(status: string): number {
  switch (status) {
    case 'not_started':
      return 1; // Red - highest priority
    case 'in_progress':
      return 2; // Yellow
    case 'complete':
      return 3; // Green
    case 'no_tasks':
      return 4; // Gray - lowest priority
    default:
      return 5;
  }
}
