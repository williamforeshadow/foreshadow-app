// List view for the rebuilt automations engine.

import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import AutomationList from '@/components/automations/v2/AutomationList';

export const dynamic = 'force-dynamic';

export default function NewEngineListPage() {
  return (
    <DesktopSidebarShell>
      <AutomationList />
    </DesktopSidebarShell>
  );
}
