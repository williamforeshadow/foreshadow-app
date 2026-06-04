// =============================================================================
// Fabricated fixtures for the public "My Assignments" demo (app/demo/assignments).
// Reuses the same users / departments / properties as the other demos. Shows one
// person's personal task queue (Maya Singh) grouped by Overdue / Today / This
// week / Later / No date — a spread of housekeeping, maintenance, inspection and
// admin work, some shared with a teammate. Zero PII (all fabricated).
// =============================================================================

import {
  DEMO_USERS,
  DEMO_DEPARTMENTS,
  DEMO_PROPERTY_OPTIONS,
} from '../schedule/demoScheduleData';

// The user whose queue this demo renders (a "random" teammate).
export const DEMO_ASSIGNMENTS_USER = DEMO_USERS[3]; // Maya Singh

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

type Status = 'paused' | 'not_started' | 'in_progress';
type Priority = 'urgent' | 'high' | 'medium' | 'low';
type Dept = 'Housekeeping' | 'Maintenance' | 'Inspection' | 'Admin';

type Spec = {
  title: string;
  propIdx: number | null; // index into DEMO_PROPERTY_OPTIONS, or null (portfolio-wide)
  dept: Dept;
  status: Status;
  priority: Priority;
  dueOff: number | null; // scheduled_date offset from today; null = no date
  time?: string; // scheduled_time
  coIdx?: number; // index into DEMO_USERS of a co-assignee (besides Maya)
};

const SPECS: Spec[] = [
  // Overdue
  { title: 'Replace leaking shower head', propIdx: 2, dept: 'Maintenance', status: 'in_progress', priority: 'high', dueOff: -2 },
  { title: 'Restock guest consumables', propIdx: 5, dept: 'Housekeeping', status: 'not_started', priority: 'medium', dueOff: -1 },
  // Today
  { title: 'Deep clean after checkout', propIdx: 7, dept: 'Housekeeping', status: 'in_progress', priority: 'urgent', dueOff: 0, time: '11:00' },
  { title: 'Inspect & swap HVAC filter', propIdx: 9, dept: 'Maintenance', status: 'not_started', priority: 'medium', dueOff: 0 },
  { title: 'Pre-arrival final walkthrough', propIdx: 11, dept: 'Inspection', status: 'not_started', priority: 'high', dueOff: 0, time: '15:30', coIdx: 1 },
  // This week
  { title: 'Re-key lockbox & update code', propIdx: 0, dept: 'Maintenance', status: 'not_started', priority: 'high', dueOff: 1, coIdx: 2 },
  { title: 'Stage welcome basket', propIdx: 4, dept: 'Housekeeping', status: 'not_started', priority: 'low', dueOff: 2 },
  { title: 'Fix wobbly stair rail', propIdx: 13, dept: 'Maintenance', status: 'not_started', priority: 'medium', dueOff: 3 },
  { title: 'Photograph completed repairs', propIdx: 8, dept: 'Admin', status: 'not_started', priority: 'low', dueOff: 4 },
  // Later
  { title: 'Touch-up paint scuffs in hallway', propIdx: 6, dept: 'Maintenance', status: 'not_started', priority: 'low', dueOff: 6 },
  { title: 'Quarterly deep maintenance pass', propIdx: 1, dept: 'Maintenance', status: 'not_started', priority: 'medium', dueOff: 9 },
  { title: 'Replace torn window screens', propIdx: 10, dept: 'Maintenance', status: 'paused', priority: 'low', dueOff: 14 },
  { title: 'Seasonal linen rotation', propIdx: null, dept: 'Housekeeping', status: 'not_started', priority: 'low', dueOff: 21 },
  // No date
  { title: 'Source new vacuum vendor', propIdx: null, dept: 'Admin', status: 'not_started', priority: 'medium', dueOff: null },
  { title: 'Review cleaning checklist v2', propIdx: null, dept: 'Admin', status: 'paused', priority: 'low', dueOff: null, coIdx: 0 },
  { title: 'Follow up on damaged-blinds claim', propIdx: 12, dept: 'Admin', status: 'in_progress', priority: 'medium', dueOff: null },
];

function assignee(u: (typeof DEMO_USERS)[number]) {
  return {
    user_id: u.id,
    name: u.name,
    avatar: u.avatar ?? null,
    role: u.role ?? '',
  };
}

/** Response shape of GET /api/my-assignments?user_id=… */
export function getDemoAssignments() {
  const me = DEMO_ASSIGNMENTS_USER;
  const tasks = SPECS.map((s, i) => {
    const d = deptByName(s.dept);
    const p = s.propIdx != null ? DEMO_PROPERTY_OPTIONS[s.propIdx] : null;
    const assigned = [assignee(me)];
    if (s.coIdx != null && DEMO_USERS[s.coIdx]?.id !== me.id) {
      assigned.push(assignee(DEMO_USERS[s.coIdx]));
    }
    return {
      task_id: `as-${i + 1}`,
      id: `as-${i + 1}`,
      title: s.title,
      template_name: null,
      description: null,
      status: s.status,
      priority: s.priority,
      department_id: d.id,
      department_name: d.name,
      scheduled_date: s.dueOff != null ? localDate(s.dueOff) : null,
      scheduled_time: s.time ?? null,
      assigned_users: assigned,
      bin_id: null,
      bin_name: null,
      is_binned: false,
      comment_count: 0,
      reservation_id: null,
      property_name: p?.name ?? '',
      property_id: p?.id ?? null,
      template_id: null,
      form_metadata: null,
      created_at: noonISO(-15 - (i % 8)),
      updated_at: noonISO(-(i % 4)),
    };
  });
  return { tasks, projects: [] as unknown[] };
}
