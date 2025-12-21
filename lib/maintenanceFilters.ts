export interface MaintenanceFilters {
  priority: string[];
  cardActions: string[];
  staff: string[];
  property: string[];
}

export function applyMaintenanceFilters(items: any[], filters: MaintenanceFilters): any[] {
  return items.filter(item => {
    // Priority filter
    if (filters.priority.length > 0) {
      if (!filters.priority.includes(item.priority || 'medium')) {
        return false;
      }
    }
    
    // Status filter
    if (filters.cardActions.length > 0) {
      if (!filters.cardActions.includes(item.status || 'not_started')) {
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
    
    // Property filter (optional for maintenance)
    if (filters.property.length > 0) {
      if (!filters.property.includes(item.property_name || 'none')) {
        return false;
      }
    }
    
    return true;
  });
}

export function sortMaintenance(items: any[], sortBy: string): any[] {
  const now = new Date().getTime();
  
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'priority-high':
        // Priority: Urgent → High → Medium → Low
        const priorityA = getPriorityValue(a.priority);
        const priorityB = getPriorityValue(b.priority);
        return priorityA - priorityB;
        
      case 'scheduled-soonest':
        // Scheduled Start: Soonest (future dates first)
        const schedA = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Infinity;
        const schedB = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Infinity;
        
        const futureSchedA = schedA < now ? Infinity : schedA;
        const futureSchedB = schedB < now ? Infinity : schedB;
        
        return futureSchedA - futureSchedB;
        
      case 'created-newest':
        // Created: Newest First
        const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return createdB - createdA; // Descending
        
      case 'created-oldest':
        // Created: Oldest First
        const oldCreatedA = a.created_at ? new Date(a.created_at).getTime() : Infinity;
        const oldCreatedB = b.created_at ? new Date(b.created_at).getTime() : Infinity;
        return oldCreatedA - oldCreatedB;
        
      case 'property-az':
        // Property Name: A-Z (treating null as "zzz" to put at end)
        const nameA = a.property_name || 'zzz_none';
        const nameB = b.property_name || 'zzz_none';
        return nameA.localeCompare(nameB);
        
      case 'status-priority':
        // Status Priority: not_started → in_progress/paused → complete
        const statusA = getStatusPriority(a.status);
        const statusB = getStatusPriority(b.status);
        
        if (statusA !== statusB) {
          return statusA - statusB;
        }
        
        // If same status, sort by created date (newest first)
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
        
      default:
        return 0;
    }
  });
}

function getPriorityValue(priority: string): number {
  switch (priority) {
    case 'urgent':
      return 1;
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
      return 4;
    default:
      return 3; // Default to medium
  }
}

function getStatusPriority(status: string): number {
  switch (status) {
    case 'not_started':
      return 1;
    case 'in_progress':
    case 'paused':
      return 2;
    case 'complete':
      return 3;
    default:
      return 1;
  }
}

