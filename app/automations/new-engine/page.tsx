// List view for the rebuilt automations engine.

import AutomationsBackLink from '@/components/automations/AutomationsBackLink';
import AutomationList from '@/components/automations/v2/AutomationList';

export const dynamic = 'force-dynamic';

export default function NewEngineListPage() {
  return (
    <>
      <div
        className="panel-form flex flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--task-surface-0)' }}
      >
        <AutomationsBackLink />

        {/* Content — the list owns its own padding and scrolling. */}
        <div className="flex-1 overflow-hidden">
          <AutomationList />
        </div>
      </div>
    </>
  );
}
