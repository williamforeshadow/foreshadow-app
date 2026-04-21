'use client';

import { useParams } from 'next/navigation';
import { CardsBoard } from '@/components/properties/cards/CardsBoard';
import { DEFAULT_INTERIOR_GROUPS } from '@/lib/propertyCards';

export default function PropertyInteriorTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;

  return (
    <CardsBoard
      propertyId={propertyId}
      scope="interior"
      sectionLabel="Interior"
      sectionCaption="Room-by-room cards for appliances, amenities, quirks, and safety items. Add as many rooms and cards as you need."
      defaultGroups={DEFAULT_INTERIOR_GROUPS}
    />
  );
}
