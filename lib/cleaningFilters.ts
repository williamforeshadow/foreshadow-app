export interface CleaningFilters {
  cleanStatus: string[];
  cardActions: string[];
  staff: string[];
}

export function applyCleaningFilters(items: any[], filters: CleaningFilters): any[] {
  return items.filter(item => {
    // Clean Status filter
    if (filters.cleanStatus.length > 0) {
      if (!filters.cleanStatus.includes(item.property_clean_status || '')) {
        return false;
      }
    }
    
    // Card Actions filter
    if (filters.cardActions.length > 0) {
      if (!filters.cardActions.includes(item.card_actions || 'not_started')) {
        return false;
      }
    }
    
    // Staff filter
    if (filters.staff.length > 0) {
      if (filters.staff.includes('unassigned')) {
        if (item.assigned_staff !== null && item.assigned_staff !== undefined) {
          if (!filters.staff.includes(item.assigned_staff)) {
            return false;
          }
        }
      } else {
        if (!filters.staff.includes(item.assigned_staff || 'unassigned')) {
          return false;
        }
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
        // Sort by status priority (red, yellow, green), then by next_check_in
        const priorityA = getSortPriority(a.property_clean_status);
        const priorityB = getSortPriority(b.property_clean_status);
        
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
    case 'needs_cleaning':
      return 1;
    case 'cleaning_scheduled':
      return 2;
    case 'cleaning_complete':
      return 3;
    default:
      return 4;
  }
}

