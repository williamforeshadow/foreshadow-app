import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import AutomationEditor from '@/components/automations/v2/AutomationEditor';

export const dynamic = 'force-dynamic';

export default async function NewEngineEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DesktopSidebarShell>
      <AutomationEditor automationId={id} />
    </DesktopSidebarShell>
  );
}
