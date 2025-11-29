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
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
        No maintenance cards found
      </div>
    );
  }

  // Apply filters and sorting
  let items = applyMaintenanceFilters(data, filters);
  
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
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
        return 'text-slate-600 dark:text-slate-400';
      case 'in_progress':
        return 'text-blue-600 dark:text-blue-400';
      case 'paused':
        return 'text-orange-600 dark:text-orange-400';
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-slate-600 dark:text-slate-400';
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
        return 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700';
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
            {item.property_name && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {item.property_name}
                </span>
              </div>
            )}

            {/* Assigned Staff */}
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
                {item.assigned_staff || 'Unassigned'}
              </span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
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

