import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import AutomationEditor from '@/components/automations/v2/AutomationEditor';

export const dynamic = 'force-dynamic';

export default function NewEngineNewPage() {
  return (
    <DesktopSidebarShell>
      <AutomationEditor />
    </DesktopSidebarShell>
  );
}
