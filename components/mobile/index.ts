// Mobile components barrel export
export { default as MobileLayout } from './MobileLayout';
export { default as MobileDrawer } from './MobileDrawer';
export { default as MobileRouteShell } from './MobileRouteShell';
export { default as MobileTimelineView } from './MobileTimelineView';
export { default as MobileProjectsView } from './MobileProjectsView';
export { default as MobileBinPicker } from './MobileBinPicker';
export { default as MobileProjectDetail } from './MobileProjectDetail';
export { default as MobileMyAssignmentsView } from './MobileMyAssignmentsView';

// Workspace view identifier. Drives the in-/ view switcher in MobileApp,
// driven via ?tab= search param.
export type MobileTab = 'assignments' | 'projects' | 'timeline';
