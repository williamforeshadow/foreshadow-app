'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import AutomationConfigEditor from '@/components/templates/AutomationConfigEditor';

function ConfigureContent() {
  const searchParams = useSearchParams();
  const property = searchParams.get('property');
  const template = searchParams.get('template');

  if (!property || !template) {
    return (
      <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <p className="text-red-500">Missing property or template parameter.</p>
      </div>
    );
  }

  return <AutomationConfigEditor propertyName={property} templateId={template} />;
}

export default function ConfigureAutomationPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
          <p className="text-neutral-500">Loading...</p>
        </div>
      }
    >
      <ConfigureContent />
    </Suspense>
  );
}
