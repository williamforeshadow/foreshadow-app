export type DashboardView = 'turnovers' | 'timeline' | 'projects' | 'tasks';

export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  turnovers: 'Turnovers',
  timeline: 'Timeline',
  projects: 'Bins',
  tasks: 'Tasks',
};

export const DASHBOARD_VIEWS: DashboardView[] = [
  'turnovers',
  'timeline',
  'projects',
  'tasks',
];

export const DASHBOARD_VIEW_STORAGE_KEY = 'dashboard:lastView';

export function isDashboardView(v: string | null | undefined): v is DashboardView {
  return (
    v === 'turnovers' ||
    v === 'timeline' ||
    v === 'projects' ||
    v === 'tasks'
  );
}
