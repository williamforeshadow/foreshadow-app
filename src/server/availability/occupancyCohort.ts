import type { SupabaseClient } from '@supabase/supabase-js';

// Occupancy cohorts for parent/child properties.
//
// A property can be part of a one-level hierarchy (enforced by the
// properties_enforce_parent_shape trigger): a parent unit physically
// encompasses its children. For OCCUPANCY questions — "is someone in this
// unit", "is this stay bookable" — a reservation or block anywhere in the
// cohort makes the related unit busy too:
//
//   cohort(child)  = { child, parent }          — the whole-house booking
//                                                  occupies the studio
//   cohort(parent) = { parent, ...children }    — a studio booking means the
//                                                  whole house isn't free
//   siblings stay independent                   — the studio and the front
//                                                  house are distinct rentals
//
// Reservations are never copied across the relation; readers union at query
// time. That keeps automations (which fire off reservation rows) scoped to
// the property the guest actually booked.

/** How a cohort member relates to the requested property. */
export type CohortRelation = 'self' | 'parent' | 'child';

export interface PropertyCohorts {
  /**
   * For each requested property id that exists: every property id whose
   * reservations/blocks count as occupancy for it (always includes itself).
   */
  cohortByProperty: Map<string, Set<string>>;
  /** Union of all cohorts — the id set occupancy queries must cover. */
  queryIds: string[];
  /**
   * Reverse index: source property id → requested property ids it affects.
   * A reservation row on `sourceId` applies to each mapped requested id.
   */
  affectedBySource: Map<string, string[]>;
  /**
   * For each requested property id: cohort member id → its relation to the
   * requested property. Lets readers report WHY an inherited interval applies
   * ("via parent listing" vs "via child listing").
   */
  relationByProperty: Map<string, Map<string, CohortRelation>>;
}

/** Identity cohorts — used when no property participates in a hierarchy. */
function identityCohorts(ids: string[]): PropertyCohorts {
  const cohortByProperty = new Map<string, Set<string>>();
  const affectedBySource = new Map<string, string[]>();
  const relationByProperty = new Map<string, Map<string, CohortRelation>>();
  for (const id of ids) {
    cohortByProperty.set(id, new Set([id]));
    affectedBySource.set(id, [id]);
    relationByProperty.set(id, new Map([[id, 'self']]));
  }
  return { cohortByProperty, queryIds: ids, affectedBySource, relationByProperty };
}

/**
 * Expand `propertyIds` to their occupancy cohorts. Two cheap indexed reads;
 * throws on a DB error (callers already degrade the same way they do for the
 * reservation queries this feeds).
 */
export async function getOccupancyCohorts(
  propertyIds: string[],
  supabase: SupabaseClient,
): Promise<PropertyCohorts> {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)));
  if (ids.length === 0) return identityCohorts(ids);

  const [ownRes, childrenRes] = await Promise.all([
    supabase.from('properties').select('id, parent_property_id').in('id', ids),
    supabase.from('properties').select('id, parent_property_id').in('parent_property_id', ids),
  ]);
  if (ownRes.error) throw new Error(`occupancy cohorts (own): ${ownRes.error.message}`);
  if (childrenRes.error) throw new Error(`occupancy cohorts (children): ${childrenRes.error.message}`);

  const parentByProperty = new Map<string, string | null>();
  for (const row of (ownRes.data ?? []) as Array<{ id: string; parent_property_id: string | null }>) {
    parentByProperty.set(row.id, row.parent_property_id);
  }
  const childrenByParent = new Map<string, string[]>();
  for (const row of (childrenRes.data ?? []) as Array<{ id: string; parent_property_id: string | null }>) {
    if (!row.parent_property_id) continue;
    const list = childrenByParent.get(row.parent_property_id);
    if (list) list.push(row.id);
    else childrenByParent.set(row.parent_property_id, [row.id]);
  }

  const cohortByProperty = new Map<string, Set<string>>();
  const affectedBySource = new Map<string, string[]>();
  const relationByProperty = new Map<string, Map<string, CohortRelation>>();
  const queryIds = new Set<string>();

  for (const id of ids) {
    // Ids that don't resolve to a property row are absent from the result,
    // matching getOccupancySnapshot's "missing means unknown" contract.
    if (!parentByProperty.has(id)) continue;
    const cohort = new Set<string>([id]);
    const relations = new Map<string, CohortRelation>([[id, 'self']]);
    const parent = parentByProperty.get(id);
    if (parent) {
      cohort.add(parent);
      relations.set(parent, 'parent');
    }
    for (const child of childrenByParent.get(id) ?? []) {
      cohort.add(child);
      relations.set(child, 'child');
    }

    cohortByProperty.set(id, cohort);
    relationByProperty.set(id, relations);
    for (const member of cohort) {
      queryIds.add(member);
      const affected = affectedBySource.get(member);
      if (affected) affected.push(id);
      else affectedBySource.set(member, [id]);
    }
  }

  return { cohortByProperty, queryIds: Array.from(queryIds), affectedBySource, relationByProperty };
}
