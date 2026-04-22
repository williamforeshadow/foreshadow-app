'use client';

import { useParams } from 'next/navigation';
import { RoomsBoard } from '@/components/properties/cards/RoomsBoard';
import { INTERIOR_ROOM_TYPES } from '@/lib/propertyCards';

export default function PropertyInteriorTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;

  return (
    <RoomsBoard
      propertyId={propertyId}
      scope="interior"
      sectionLabel="Interior"
      sectionCaption="Add rooms like bedrooms, bathrooms, kitchen, or anything else. Each room can hold photos and tagged cards (appliances, amenities, safety items, quirks)."
      noun="room"
      nounPlural="rooms"
      roomTypes={INTERIOR_ROOM_TYPES}
    />
  );
}
