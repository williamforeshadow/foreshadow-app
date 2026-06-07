import type { PmsMapper } from './types';
import { hostawayMapper } from './hostaway';

const MAPPERS: Record<string, PmsMapper> = {
  hostaway: hostawayMapper,
};

/** Resolve the normalizer for a PMS source. Defaults to Hostaway. */
export function getMapper(source: string = 'hostaway'): PmsMapper {
  return MAPPERS[source] ?? hostawayMapper;
}

export type { PmsMapper } from './types';
