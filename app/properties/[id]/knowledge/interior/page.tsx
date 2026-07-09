'use client';

import { useParams } from 'next/navigation';
import { RoomsBoard } from '@/components/properties/cards/RoomsBoard';

export default function PropertyInteriorTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;

  return (
    <RoomsBoard
      propertyId={propertyId}
      scope="interior"
      sectionLabel="Interior"
      noun="room"
      nounPlural="rooms"
    />
  );
}
