import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import SlackAutomationEditor from '@/components/automations/SlackAutomationEditor';

export default async function EditSlackAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DesktopSidebarShell>
      <SlackAutomationEditor automationId={id} />
    </DesktopSidebarShell>
  );
}
