'use client';

import { useParams } from 'next/navigation';
import { WifiSection } from '@/components/properties/connectivity/WifiSection';
import { TechAccountsList } from '@/components/properties/connectivity/TechAccountsList';
import {
  SectionCaption,
  SectionHeader,
} from '@/components/properties/form/FormPrimitives';

export default function PropertyConnectivityTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  if (!propertyId) return null;

  // The WiFi section manages its own FloatingSaveBar (singleton, explicit
  // save). The accounts list autosaves per-card. That means the tab has
  // two independent save surfaces, which is fine — users don't expect a
  // single Save button to span a singleton + a collection.
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[760px] mx-auto px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
        <section className="mb-6">
          <SectionHeader label="Connectivity" />
          <SectionCaption>
            WiFi, streaming, smart home — anything guests or cleaners need to
            log into.
          </SectionCaption>
        </section>

        <WifiSection propertyId={propertyId} />

        <div className="mt-10">
          <TechAccountsList propertyId={propertyId} />
        </div>
      </div>
    </div>
  );
}
