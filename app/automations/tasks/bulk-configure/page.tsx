'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import BulkAutomationConfigEditor from '@/components/templates/BulkAutomationConfigEditor';

function BulkConfigureContent() {
  const searchParams = useSearchParams();
  const propertiesParam = searchParams.get('properties');
  const template = searchParams.get('template');

  if (!propertiesParam || !template) {
    return (
      <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-red-500">Missing properties or template parameter.</p>
      </div>
    );
  }

  const propertyNames = propertiesParam.split(',').filter(Boolean);

  if (propertyNames.length === 0) {
    return (
      <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-red-500">No properties specified.</p>
      </div>
    );
  }

  return <BulkAutomationConfigEditor propertyNames={propertyNames} templateId={template} />;
}

export default function BulkConfigureAutomationPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
          <p className="text-neutral-500">Loading...</p>
        </div>
      }
    >
      <BulkConfigureContent />
    </Suspense>
  );
}
