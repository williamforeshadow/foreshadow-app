'use client';

import { usePropertyContext } from '@/components/properties/PropertyContext';
import { PropertyTasksView } from '@/components/properties/tasks/PropertyTasksView';

// Tasks ledger for a single property. Renders full-width inside the
// PropertyShell (bypasses the 760px knowledge column) since it's a data
// dashboard, not a form. Every task ever associated with the property is
// shown — filter + sort + search do the curation.
export default function PropertyTasksTab() {
  const { property } = usePropertyContext();
  if (!property) return null;
  return (
    <PropertyTasksView propertyId={property.id} propertyName={property.name} />
  );
}
