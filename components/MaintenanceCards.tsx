import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { applyMaintenanceFilters, sortMaintenance, type MaintenanceFilters } from '@/lib/maintenanceFilters';

interface MaintenanceCardsProps {
  data: any[];
  filters: MaintenanceFilters;
  sortBy: string;
  onCardClick: (card: any) => void;
}

export default function MaintenanceCards({ data, filters, sortBy, onCardClick }: MaintenanceCardsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No maintenance cards found
      </div>
    );
  }

  // Apply filters and sorting
  let items = applyMaintenanceFilters(data, filters);
  
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No cards match the selected filters
      </div>
    );
  }

  items = sortMaintenance(items, sortBy);

  const formatDate = (dateString: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getPriorityVariant = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'destructive';
      case 'high':
        return 'default';
      case 'low':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'text-neutral-600 dark:text-neutral-400';
      case 'in_progress':
        return 'text-blue-600 dark:text-blue-400';
      case 'paused':
        return 'text-orange-600 dark:text-orange-400';
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-neutral-600 dark:text-neutral-400';
    }
  };

  const getCardBackgroundColor = (cardAction: string) => {
    switch (cardAction) {
      case 'not_started':
        return 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900';
      case 'in_progress':
      case 'paused':
        return 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900';
      case 'completed':
        return 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900';
      default:
        return 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700';
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {items.map((item, index) => (
        <Card
          key={item.id || index}
          onClick={() => onCardClick(item)}
          className={`cursor-pointer hover:shadow-xl transition-all duration-200 ${getCardBackgroundColor(item.card_actions)}`}
        >
          <CardHeader>
            <CardTitle className="line-clamp-2">
              {item.title || 'Untitled Maintenance'}
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {item.description || 'No description'}
            </CardDescription>
            <CardAction>
              <Badge variant={getPriorityVariant(item.priority)} className="capitalize">
                {item.priority || 'Medium'}
              </Badge>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-3">
            {/* Property Name (if exists) */}
            {item.property_name ? (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                  {item.property_name}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400 italic truncate">
                  General
                </span>
              </div>
            )}

            {/* Occupancy Status */}
            <div className="flex items-center gap-2">
              <svg className={`w-4 h-4 shrink-0 ${
                item.occupancy_status === 'occupied' ? 'text-orange-500' : 
                item.occupancy_status === 'general' ? 'text-neutral-400' : 
                'text-neutral-400'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <Badge 
                variant={item.occupancy_status === 'occupied' ? 'default' : 'outline'}
                className={`text-xs ${
                  item.occupancy_status === 'occupied' 
                    ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                    : item.occupancy_status === 'general'
                    ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300'
                }`}
              >
                {item.occupancy_status === 'occupied' ? 'Occupied' : 
                 item.occupancy_status === 'general' ? 'General' : 
                 'Vacant'}
              </Badge>
            </div>

            {/* Assigned Staff */}
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-neutral-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-sm text-neutral-600 dark:text-neutral-400 truncate">
                {item.assigned_staff || 'Unassigned'}
              </span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-neutral-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`text-sm font-medium ${getStatusColor(item.card_actions)}`}>
                {item.card_actions === 'not_started' ? 'Not Started' :
                 item.card_actions === 'in_progress' ? 'In Progress' :
                 item.card_actions === 'paused' ? 'Paused' :
                 item.card_actions === 'completed' ? 'Completed' :
                 'Not Started'}
              </span>
            </div>

            {/* Scheduled Start (if exists) */}
            {item.scheduled_start && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-neutral-600 dark:text-neutral-400 truncate">
                  {formatDate(item.scheduled_start)}
                </span>
              </div>
            )}
          </CardContent>

          <CardFooter className="text-xs text-muted-foreground">
            Created {formatDate(item.created_at) || 'Unknown'}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

