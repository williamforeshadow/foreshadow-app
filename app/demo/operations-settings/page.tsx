'use client';

// Demo fixture for the operations settings page. Public (/demo is auth-exempt)
// so the layout is browser-verifiable without a session.
//
// The page reads useOperationsSettings(), which fetches on mount and would
// otherwise 401 — so this supplies a mock context value, the same way the
// other /demo pages do. `save` resolves ok without a network call. Demo-only.

import { OperationsSettingsContext, DEFAULT_SETTINGS } from '@/lib/operationsSettingsContext';
import OperationsSettingsPage from '@/app/operations-settings/page';

const OPS_VALUE = {
  settings: {
    ...DEFAULT_SETTINGS,
    default_check_in_time: '16:00',
    default_check_out_time: '11:00',
    default_timezone: 'America/Los_Angeles',
  },
  loading: false,
  error: null,
  migrationPending: false,
  refresh: async () => {},
  save: async () => ({ ok: true as const }),
};

export default function OperationsSettingsDemoPage() {
  return (
    <OperationsSettingsContext.Provider value={OPS_VALUE}>
      <OperationsSettingsPage />
    </OperationsSettingsContext.Provider>
  );
}
