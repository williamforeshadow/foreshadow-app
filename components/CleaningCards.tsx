import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { applyCleaningFilters, sortCleanings, type CleaningFilters } from '@/lib/cleaningFilters';

interface CleaningCardsProps {
  data: any[] | null;
  filters: CleaningFilters;
  sortBy: string;
  onCardClick: (card: any) => void;
}

export default function CleaningCards({ data, filters, sortBy, onCardClick }: CleaningCardsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
        No cleanings found
      </div>
    );
  }

  // Apply filters and sorting
  let items = applyCleaningFilters(data, filters);
  
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
        No cards match the selected filters
      </div>
    );
  }

  items = sortCleanings(items, sortBy);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getCardBackgroundColor = (status: string) => {
    switch (status) {
      case 'needs_cleaning':
        return 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900';
      case 'cleaning_scheduled':
        return 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900';
      case 'cleaning_complete':
        return 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900';
      default:
        return 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700';
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {items.map((item, index) => (
        <Card
          key={item.cleaning_id || item.id || index}
          onClick={() => onCardClick(item)}
          className={`cursor-pointer hover:shadow-xl transition-all duration-200 ${getCardBackgroundColor(item.property_clean_status)}`}
        >
          <CardHeader>
            <CardTitle>{item.property_name || 'Unknown Property'}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {item.guest_name || <span className="italic opacity-60">No guest</span>}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Dates */}
            <div className="space-y-2.5">
              {/* Checked Out */}
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Checked out</div>
                  <div className="text-sm truncate font-medium text-slate-900 dark:text-white">
                    {item.check_out ? formatDate(item.check_out) : <span className="italic opacity-60">Not set</span>}
                  </div>
                </div>
              </div>

              {/* Next Check In */}
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Next check in</div>
                  <div className="text-sm truncate font-medium text-slate-900 dark:text-white">
                    {item.next_check_in ? formatDate(item.next_check_in) : <span className="italic opacity-60">Not set</span>}
                  </div>
                </div>
              </div>

              {/* Scheduled Start */}
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Scheduled</div>
                  <div className="text-sm truncate font-medium text-slate-900 dark:text-white">
                    {item.scheduled_start ? formatDate(item.scheduled_start) : <span className="italic opacity-60">Not set</span>}
                  </div>
                </div>
              </div>

              {/* Card Actions - Read Only */}
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Action</div>
                  <div className={`text-sm font-medium ${
                    item.card_actions === 'in_progress' ? 'text-blue-600 dark:text-blue-400' :
                    item.card_actions === 'paused' ? 'text-orange-600 dark:text-orange-400' :
                    item.card_actions === 'completed' ? 'text-green-600 dark:text-green-400' :
                    'text-slate-600 dark:text-slate-400'
                  }`}>
                    {item.card_actions === 'not_started' ? 'Not Started' :
                     item.card_actions === 'in_progress' ? 'In Progress' :
                     item.card_actions === 'paused' ? 'Paused' :
                     item.card_actions === 'completed' ? 'Completed' :
                     'Not Started'}
                  </div>
                </div>
              </div>

              {/* Occupancy Status */}
              <div className="flex items-center gap-3">
                <svg className={`w-4 h-4 shrink-0 ${item.occupancy_status === 'occupied' ? 'text-orange-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Occupancy</div>
                  <Badge 
                    variant={item.occupancy_status === 'occupied' ? 'default' : 'outline'}
                    className={item.occupancy_status === 'occupied' 
                      ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-300' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300'
                    }
                  >
                    {item.occupancy_status === 'occupied' ? 'Occupied' : 'Vacant'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Status Badges */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge 
                variant={
                  item.property_clean_status === 'needs_cleaning' ? 'destructive' :
                  item.property_clean_status === 'cleaning_complete' ? 'default' : 'secondary'
                }
                className={
                  item.property_clean_status === 'needs_cleaning' 
                    ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300'
                    : item.property_clean_status === 'cleaning_scheduled'
                    ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300'
                    : item.property_clean_status === 'cleaning_complete'
                    ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-300'
                    : ''
                }
              >
                {item.property_clean_status === 'needs_cleaning' ? 'Needs Cleaning' :
                 item.property_clean_status === 'cleaning_scheduled' ? 'Scheduled' :
                 item.property_clean_status === 'cleaning_complete' ? 'Complete' :
                 'Unknown'}
              </Badge>
              
              <Badge variant={item.assigned_staff ? 'default' : 'outline'}>
                {item.assigned_staff ? item.assigned_staff : 'Unassigned'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

