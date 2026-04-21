'use client';

import { useParams } from 'next/navigation';
import { CardsBoard } from '@/components/properties/cards/CardsBoard';
import { DEFAULT_EXTERIOR_GROUPS } from '@/lib/propertyCards';

export default function PropertyExteriorTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;

  return (
    <CardsBoard
      propertyId={propertyId}
      scope="exterior"
      sectionLabel="Exterior & Building Systems"
      sectionCaption="Outside-the-unit context: utilities, trash, HVAC, parking structure, mail, outdoor features."
      defaultGroups={DEFAULT_EXTERIOR_GROUPS}
    />
  );
}
