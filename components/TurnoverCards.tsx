import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { applyCleaningFilters, sortCleanings, type CleaningFilters } from '@/lib/cleaningFilters';

interface TurnoverCardsProps {
  data: any[] | null;
  filters: CleaningFilters;
  sortBy: string;
  onCardClick: (card: any) => void;
}

export default function TurnoverCards({ data, filters, sortBy, onCardClick }: TurnoverCardsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No turnovers found
      </div>
    );
  }

  // Apply filters and sorting
  let items = applyCleaningFilters(data, filters);
  
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
        No cards match the selected filters
      </div>
    );
  }

  items = sortCleanings(items, sortBy);

  const formatDate = (dateString: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric', 
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // New: Use turnover_status for card colors
  const getCardBackgroundColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900';
      case 'in_progress':
        return 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900';
      case 'complete':
        return 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900';
      case 'no_tasks':
        return 'bg-neutral-50/80 dark:bg-neutral-800/30 border-neutral-200 dark:border-neutral-700';
      default:
        return 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700';
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 auto-rows-fr">
      {items.map((item, index) => (
        <Card
          key={item.cleaning_id || item.id || index}
          onClick={() => onCardClick(item)}
          className={`group cursor-pointer hover:shadow-xl transition-all duration-200 !flex !flex-col !p-4 gap-4 ${getCardBackgroundColor(item.turnover_status)}`}
        >
          <CardHeader className="min-h-[4rem]">
            <CardTitle className="text-base leading-tight line-clamp-2">
              {item.property_name || 'Unknown Property'}
            </CardTitle>
            <CardDescription className="line-clamp-1">
              {item.guest_name || '\u00A0'}
            </CardDescription>
            <CardAction>
              {/* Task Count Badge */}
              {item.total_tasks > 0 && (
                <Badge 
                  className={`font-semibold px-2.5 py-1 ${
                    item.turnover_status === 'complete' 
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                      : item.turnover_status === 'in_progress'
                      ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                  }`}
                >
                  {item.completed_tasks || 0}/{item.total_tasks}
                </Badge>
              )}
            </CardAction>
          </CardHeader>

          <CardContent className="flex-grow">
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Status Badge */}
                <Badge 
                  className={`px-2.5 py-1 ${
                    item.turnover_status === 'complete' 
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                      : item.turnover_status === 'in_progress'
                      ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
                      : item.turnover_status === 'not_started'
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                      : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {item.turnover_status === 'complete' ? 'Complete' :
                   item.turnover_status === 'in_progress' ? 'In Progress' :
                   item.turnover_status === 'not_started' ? 'Not Started' :
                   'No Tasks'}
                </Badge>
                {/* Occupancy Badge */}
                <Badge 
                  className={`px-2.5 py-1 ${
                    item.occupancy_status === 'occupied' 
                      ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                      : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {item.occupancy_status === 'occupied' ? 'Occupied' : 'Vacant'}
                </Badge>
              </div>
            </div>
          </CardContent>

          <CardFooter className="mt-auto flex flex-col gap-2">
            <div className="w-full py-1">
              <div className="h-px w-full bg-border/60" />
            </div>
            <div className="flex w-full justify-between text-xs text-muted-foreground/60">
              {/* Check Out Date */}
              <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 transition-all duration-150 hover:border-border hover:bg-[var(--mix-card-50-bg)] ${
                !item.check_out ? 'opacity-40' : ''
              }`}>
                <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>{formatDate(item.check_out) || 'Out'}</span>
              </div>
              {/* Check In Date */}
              <div className={`flex h-[27px] items-center justify-center gap-1 rounded-xl border border-border/20 bg-[var(--mix-card-33-bg)] px-2 py-1 transition-all duration-150 hover:border-border hover:bg-[var(--mix-card-50-bg)] ${
                !item.next_check_in ? 'opacity-40' : ''
              }`}>
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <span>{formatDate(item.next_check_in) || 'In'}</span>
              </div>
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

