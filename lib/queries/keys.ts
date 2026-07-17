// Central query-key registry. Every useQuery/setQueryData/invalidateQueries
// call goes through these so cache keys can't drift between surfaces.
export const qk = {
  properties: ['properties'] as const,
  // include_inactive variant; shares the ['properties'] prefix deliberately so
  // one invalidateQueries(['properties']) sweeps both lists.
  propertiesAll: ['properties', 'all'] as const,
  taskTemplates: ['task-templates'] as const,
  // Per-template detail (GET /api/templates/[id]?property_name=X) — distinct
  // from the taskTemplates picker list above.
  templateDetail: (templateId: string, propertyName: string | null) =>
    ['template-detail', templateId, propertyName ?? ''] as const,
  projectBins: ['project-bins'] as const,
  myAssignments: (userId: string) => ['my-assignments', userId] as const,
  timeline: ['timeline'] as const,
  allTasks: ['all-tasks'] as const,
  turnovers: ['turnovers'] as const,
  tasksForBin: (apiBinId: string | null, viewerUserId: string | null) =>
    ['tasks-for-bin', apiBinId ?? '__task_bin__', viewerUserId ?? ''] as const,
  conversations: (tab: string, sort: string) => ['conversations', tab, sort] as const,
  conversation: (id: string) => ['conversation', id] as const,
  reservationWindowTasks: (reservationId: string) =>
    ['reservation-window-tasks', reservationId] as const,
  notifications: (view: string) => ['notifications', view] as const,
  property: (id: string) => ['property', id] as const,
  // Shares the ['property', id] prefix so a property-wide invalidate sweeps
  // its knowledge tabs; use exact:true for profile-only refreshes.
  propertyKnowledge: (id: string, section: string) =>
    ['property', id, 'knowledge', section] as const,
  // The per-property task ledger (GET /api/properties/[id]/tasks).
  propertyTasks: (id: string) => ['property', id, 'tasks'] as const,
};
