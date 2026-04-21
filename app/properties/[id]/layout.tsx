'use client';

import { useParams } from 'next/navigation';
import { PropertyShell } from '@/components/properties/PropertyShell';

// Detail layout: wraps every /properties/[id]/** route with a shared
// property fetch + header + tab strip. Each tab renders inside this
// layout and can use usePropertyContext() to access the loaded property
// without re-fetching.
export default function PropertyDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;
  return <PropertyShell propertyId={propertyId}>{children}</PropertyShell>;
}
