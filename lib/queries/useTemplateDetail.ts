'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { Template } from '@/components/DynamicCleaningForm';
import { qk } from './keys';
import { fetchJson } from './fetchJson';

// Per-template detail (GET /api/templates/[id], optionally property-scoped so
// property-level field overrides resolve). Several surfaces keep a local
// Record<cacheKey, Template> mirror for synchronous reads; they source it via
// ensureTemplateDetail so the network fetch is shared and deduped app-wide.

export async function fetchTemplateDetail(
  templateId: string,
  propertyName?: string | null
): Promise<Template> {
  const url = propertyName
    ? `/api/templates/${templateId}?property_name=${encodeURIComponent(propertyName)}`
    : `/api/templates/${templateId}`;
  const json = await fetchJson<{ template: Template }>(url);
  return json.template;
}

export function ensureTemplateDetail(
  queryClient: QueryClient,
  templateId: string,
  propertyName?: string | null
): Promise<Template> {
  return queryClient.ensureQueryData({
    queryKey: qk.templateDetail(templateId, propertyName ?? null),
    queryFn: () => fetchTemplateDetail(templateId, propertyName),
    // Template bodies change rarely; don't refetch them on every detail open.
    staleTime: 5 * 60_000,
  });
}
