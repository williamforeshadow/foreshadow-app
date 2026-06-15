'use client';

import { useParams } from 'next/navigation';
import { RoomsBoard } from '@/components/properties/cards/RoomsBoard';

export default function PropertyExteriorTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;

  return (
    <RoomsBoard
      propertyId={propertyId}
      scope="exterior"
      sectionLabel="Exterior & Building Systems"
      sectionCaption="Outside-the-unit areas: garage, driveway, backyard, utilities, trash, HVAC, mail. Each area can hold notes, photos, and tagged attributes."
      noun="area"
      nounPlural="areas"
    />
  );
}
