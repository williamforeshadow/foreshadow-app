// Central query-key registry. Every useQuery/setQueryData/invalidateQueries
// call goes through these so cache keys can't drift between surfaces.
export const qk = {
  properties: ['properties'] as const,
  taskTemplates: ['task-templates'] as const,
  projectBins: ['project-bins'] as const,
  myAssignments: (userId: string) => ['my-assignments', userId] as const,
  timeline: ['timeline'] as const,
};
