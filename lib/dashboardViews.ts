export type DashboardView = 'turnovers' | 'timeline' | 'projects' | 'tasks';

// NOTE: keys are internal + baked into URLs (?view=turnovers) and
// localStorage; labels are the client-facing names. 'turnovers' displays as
// "Reservations" (renamed 2026-08-11) — same pattern as 'timeline' showing
// "Schedule". Don't rename keys without a URL alias.
export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  turnovers: 'Reservations',
  timeline: 'Schedule',
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
