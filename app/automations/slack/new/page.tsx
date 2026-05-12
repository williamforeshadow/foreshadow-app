import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import SlackAutomationEditor from '@/components/automations/SlackAutomationEditor';

export default function NewSlackAutomationPage() {
  return (
    <DesktopSidebarShell>
      <SlackAutomationEditor />
    </DesktopSidebarShell>
  );
}
