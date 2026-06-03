// =============================================================================
// Fabricated fixtures for the public Bins/Boards demo (app/demo/bins).
// Reuses the same users / departments / properties as the schedule demo.
// These are the longer-horizon, often-outsourced items that — in Foreshadow —
// land on a shared board instead of a separate issue tracker. ~27 tasks; most
// carry a property, some are portfolio-wide. Zero PII (all fabricated).
// =============================================================================

import type { ProjectBin } from '@/lib/types';
import {
  DEMO_USERS,
  DEMO_DEPARTMENTS,
  DEMO_PROPERTY_OPTIONS,
} from '../schedule/demoScheduleData';

function noonISO(offset: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}
function localDate(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const deptByName = (name: string) =>
  DEMO_DEPARTMENTS.find((d) => d.name === name) ?? DEMO_DEPARTMENTS[0];

/** Single system board holding the 27 tasks. */
export const DEMO_PROJECT_BINS: ProjectBin[] = [
  {
    id: 'bin-tasks',
    name: 'Task Bin',
    description: null,
    created_by: null,
    created_at: noonISO(-120),
    updated_at: noonISO(-1),
    sort_order: 0,
    auto_dismiss_enabled: false,
    auto_dismiss_days: 7,
    is_system: true,
    project_count: 27,
  },
];

type Status = 'paused' | 'not_started' | 'in_progress' | 'complete';
type Priority = 'urgent' | 'high' | 'medium' | 'low';
type Dept = 'Housekeeping' | 'Maintenance' | 'Inspection' | 'Admin';

type Spec = {
  title: string;
  propIdx: number | null; // index into DEMO_PROPERTY_OPTIONS, or null (portfolio-wide)
  dept: Dept;
  status: Status;
  priority: Priority;
  userIdx: number | null; // index into DEMO_USERS, or null (unassigned)
  dueOff?: number; // scheduled_date offset from today; omit for no date
};

const SPECS: Spec[] = [
  { title: 'Owner statement review — June', propIdx: null, dept: 'Admin', status: 'in_progress', priority: 'high', userIdx: 0 },
  { title: 'Source vendor for chipped vanity', propIdx: 1, dept: 'Maintenance', status: 'not_started', priority: 'medium', userIdx: 1 },
  { title: 'Audit Airbnb listing descriptions', propIdx: null, dept: 'Admin', status: 'not_started', priority: 'medium', userIdx: 0 },
  { title: 'Submit STR license renewal with the city', propIdx: null, dept: 'Admin', status: 'in_progress', priority: 'urgent', userIdx: 0, dueOff: 5 },
  { title: 'Replace cracked patio tile', propIdx: 3, dept: 'Maintenance', status: 'not_started', priority: 'high', userIdx: 2 },
  { title: 'Get quote to repaint exterior trim', propIdx: 2, dept: 'Maintenance', status: 'paused', priority: 'low', userIdx: 3 },
  { title: 'Schedule deep carpet cleaning', propIdx: 5, dept: 'Housekeeping', status: 'not_started', priority: 'medium', userIdx: 4 },
  { title: 'Order replacement smart lock', propIdx: 0, dept: 'Maintenance', status: 'in_progress', priority: 'high', userIdx: 1 },
  { title: 'Refresh listing photos with Nolan', propIdx: 7, dept: 'Admin', status: 'not_started', priority: 'medium', userIdx: 0, dueOff: 9 },
  { title: 'Resolve HOA parking complaint', propIdx: 8, dept: 'Admin', status: 'in_progress', priority: 'high', userIdx: 2 },
  { title: 'Renew pool service contract', propIdx: 9, dept: 'Maintenance', status: 'not_started', priority: 'low', userIdx: 3 },
  { title: 'Investigate high water bill', propIdx: 10, dept: 'Maintenance', status: 'in_progress', priority: 'medium', userIdx: 4 },
  { title: 'Replace worn master mattress', propIdx: 11, dept: 'Housekeeping', status: 'not_started', priority: 'medium', userIdx: 1 },
  { title: 'Install owner-requested EV charger', propIdx: 12, dept: 'Maintenance', status: 'paused', priority: 'low', userIdx: 2 },
  { title: 'Get bids for roof inspection', propIdx: 13, dept: 'Inspection', status: 'not_started', priority: 'high', userIdx: 3 },
  { title: 'Quarterly safety inspection', propIdx: 14, dept: 'Inspection', status: 'complete', priority: 'medium', userIdx: 4 },
  { title: 'Negotiate cleaner rate increase', propIdx: null, dept: 'Admin', status: 'in_progress', priority: 'medium', userIdx: 0 },
  { title: 'Fix slow kitchen drain', propIdx: 16, dept: 'Maintenance', status: 'not_started', priority: 'medium', userIdx: 1 },
  { title: 'Update WiFi name & password', propIdx: 17, dept: 'Maintenance', status: 'complete', priority: 'low', userIdx: 2 },
  { title: 'Source firewood vendor for winter', propIdx: 18, dept: 'Maintenance', status: 'not_started', priority: 'low', userIdx: 3 },
  { title: 'Noise-complaint follow-up with guest', propIdx: 19, dept: 'Admin', status: 'in_progress', priority: 'high', userIdx: 4 },
  { title: 'Q2 expense reconciliation', propIdx: null, dept: 'Admin', status: 'in_progress', priority: 'high', userIdx: 0 },
  { title: 'Update insurance certificates', propIdx: null, dept: 'Admin', status: 'not_started', priority: 'urgent', userIdx: 0, dueOff: 12 },
  { title: 'Onboard new cleaning subcontractor', propIdx: null, dept: 'Housekeeping', status: 'in_progress', priority: 'medium', userIdx: null },
  { title: 'Audit pricing for peak season', propIdx: null, dept: 'Admin', status: 'paused', priority: 'medium', userIdx: null },
  { title: 'Replace HVAC filters — portfolio sweep', propIdx: null, dept: 'Maintenance', status: 'complete', priority: 'low', userIdx: 1 },
  { title: 'Restock owner welcome baskets', propIdx: 4, dept: 'Housekeeping', status: 'complete', priority: 'low', userIdx: 4 },
];

/** Rows as the GET /api/tasks-for-bin endpoint returns them. */
export function getDemoBinTasks() {
  return SPECS.map((s, i) => {
    const d = deptByName(s.dept);
    const p = s.propIdx != null ? DEMO_PROPERTY_OPTIONS[s.propIdx] : null;
    const u = s.userIdx != null ? DEMO_USERS[s.userIdx] : null;
    return {
      id: `bt-${i + 1}`,
      property_name: p?.name ?? null,
      property_id: p?.id ?? null,
      reservation_id: null,
      bin_id: 'bin-tasks',
      is_binned: true,
      template_id: null,
      template_name: null,
      title: s.title,
      description: null,
      status: s.status,
      priority: s.priority,
      department_id: d.id,
      department_name: d.name,
      scheduled_date: s.dueOff != null ? localDate(s.dueOff) : null,
      scheduled_time: null,
      form_metadata: null,
      created_at: noonISO(-20 - (i % 10)),
      updated_at: noonISO(-(i % 5)),
      completed_at: s.status === 'complete' ? noonISO(-(i % 4) - 1) : null,
      unread_comment_count: 0,
      project_assignments: u
        ? [
            {
              user_id: u.id,
              assigned_at: noonISO(-7),
              user: { id: u.id, name: u.name, email: u.email ?? null, role: u.role ?? '', avatar: u.avatar ?? null },
            },
          ]
        : [],
    };
  });
}
