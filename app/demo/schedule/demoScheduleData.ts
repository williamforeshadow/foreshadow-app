// =============================================================================
// Fabricated fixtures for the public Schedule demo (app/demo/schedule).
// NOTHING here is real — no real guests, properties, or staff — so the public
// demo carries zero PII.
//
// All dates are generated RELATIVE TO `new Date()` AT CALL TIME, so the demo
// can never go stale: every load re-anchors to the current week, and data is
// spread across a rolling ~±2-week window so navigating prev/next/month always
// lands on a populated view.
// =============================================================================

import type {
  Turnover,
  Task,
  TaskStatus,
  Department,
  TurnoverStatus,
  OccupancyStatus,
} from '@/lib/types';
import type { AppUser } from '@/lib/authContext';

// ---- date helpers -----------------------------------------------------------

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

const EPOCH = '2025-01-01T00:00:00.000Z';

// ---- users (5 → 5 day-kanban columns) ---------------------------------------

export const DEMO_USERS: AppUser[] = [
  { id: 'u-1', name: 'Alex Rivera', email: 'alex@example.com', role: 'manager' },
  { id: 'u-2', name: 'Sam Carter', email: 'sam@example.com', role: 'staff' },
  { id: 'u-3', name: 'Jordan Lee', email: 'jordan@example.com', role: 'staff' },
  { id: 'u-4', name: 'Maya Singh', email: 'maya@example.com', role: 'staff' },
  { id: 'u-5', name: 'Theo Banks', email: 'theo@example.com', role: 'staff' },
];

export const DEMO_USER: AppUser = DEMO_USERS[0];

// ---- core departments -------------------------------------------------------

export const DEMO_DEPARTMENTS: Department[] = [
  { id: 'd-house', name: 'Housekeeping', icon: 'spray-can', created_at: EPOCH, updated_at: EPOCH },
  { id: 'd-maint', name: 'Maintenance', icon: 'wrench', created_at: EPOCH, updated_at: EPOCH },
  { id: 'd-inspect', name: 'Inspection', icon: 'clipboard-check', created_at: EPOCH, updated_at: EPOCH },
  { id: 'd-admin', name: 'Admin', icon: 'building', created_at: EPOCH, updated_at: EPOCH },
];

export const DEMO_DEPT_ICON_MAP: Record<string, string | undefined> = Object.fromEntries(
  DEMO_DEPARTMENTS.map((d) => [d.id, d.icon]),
);

// ---- properties (20) --------------------------------------------------------

const PROPERTY_NAMES = [
  '418 Seabreeze Ln',
  '2100 Marina Blvd #4B',
  '77 Pine Ridge Rd',
  '950 Harbor View Dr',
  '32 Old Town Sq',
  '1605 Sunset Ave',
  '240 Cedar Hollow',
  '88 Lakeshore Way',
  '511 Magnolia St',
  '1240 Canyon Rd',
  '6 Driftwood Ct',
  '320 Birch Park Pl',
  '74 Summit Terrace',
  '1890 Bayfront #12',
  '405 Willow Bend',
  '23 Coral Reef Dr',
  '760 Aspen Grove',
  '99 Harborlight Ln',
  '1450 Vista Del Mar',
  '57 Meadowlark Rd',
];

const PROPERTIES = PROPERTY_NAMES.map((name, i) => ({ id: `p-${i + 1}`, name }));

/** Property options as returned by GET /api/properties. */
export const DEMO_PROPERTY_OPTIONS = PROPERTIES.map((p) => ({ id: p.id, name: p.name }));

// ---- builders ---------------------------------------------------------------

const GUESTS = [
  'Avery Chen', 'Marcus Bell', 'Priya Nair', 'Diego Santos', 'Hannah Wolfe',
  'Liam O’Brien', 'Sofia Rossi', 'Mateo Cruz', 'Nina Patel', 'Owen Brooks',
  'Lucia Romano', 'Caleb Ford', 'Amara Okafor', 'Ethan Wade', 'Isla Fraser',
  'Ruben Diaz', 'Mia Tanaka', 'Jonah Reed', 'Elena Petrova', 'Cole Hayes',
];

const OCC: OccupancyStatus[] = ['occupied', 'vacant'];

// Status is derived purely from time (per the demo spec): anything in the past
// is complete, today is in progress, the future is not started.
function taskStatusFor(offset: number): TaskStatus {
  if (offset < 0) return 'complete';
  if (offset === 0) return 'in_progress';
  return 'not_started';
}
function turnoverStatusFor(inOff: number, outOff: number): TurnoverStatus {
  if (outOff < 0) return 'complete'; // already checked out
  if (inOff > 0) return 'not_started'; // not arrived yet
  return 'in_progress'; // currently in-house / turning over today
}

const TURNOVER_TASK_TITLES = ['Turnover clean', 'Restock & staging', 'Walkthrough inspection'];

function dept(i: number): Department {
  return DEMO_DEPARTMENTS[i % DEMO_DEPARTMENTS.length];
}
function user(i: number): AppUser {
  return DEMO_USERS[i % DEMO_USERS.length];
}
function assignee(u: AppUser) {
  return { user_id: u.id, name: u.name, avatar: u.avatar ?? '', role: u.role ?? '' };
}

function buildTask(
  prop: { id: string; name: string },
  title: string,
  status: TaskStatus,
  offset: number,
  u: AppUser,
  d: Department,
  seq: number,
): Task {
  return {
    task_id: `t-${seq}`,
    template_id: undefined,
    template_name: title,
    title,
    description: null,
    priority: ['low', 'medium', 'high'][seq % 3],
    bin_id: null,
    is_binned: false,
    department_id: d.id,
    department_name: d.name,
    status,
    property_id: prop.id,
    property_name: prop.name,
    assigned_users: [assignee(u)],
    scheduled_date: localDate(offset),
    scheduled_time: null,
    reservation_id: 'res',
  };
}

// ---- turnovers (the `get_property_turnovers` RPC response) -------------------

/** Returns the array the RPC would return — ~3 stays per property across a
 *  rolling window (past / current / future) so every navigable view is full. */
export function getDemoTurnovers(): Turnover[] {
  const out: Turnover[] = [];
  let resSeq = 0;
  let taskSeq = 0;

  PROPERTIES.forEach((prop, pi) => {
    // Three stays: one in the current week (guaranteed overlap), one earlier,
    // one later — so prev/next/month navigation stays populated.
    const starts = [-1 + (pi % 4), -12 - (pi % 6), 9 + (pi % 8)];

    starts.forEach((inOff, si) => {
      const idx = pi * 3 + si;
      // ~30% of reservations are long stays (>= 10 days).
      const isLong = idx % 10 < 3;
      const len = isLong ? 10 + (pi % 6) : 2 + ((pi + si) % 4);
      const checkOutOff = inOff + len;
      resSeq += 1;

      const status = turnoverStatusFor(inOff, checkOutOff);
      const tStatus = taskStatusFor(checkOutOff); // tasks happen on the turnover (check-out) day
      const occ = OCC[(pi + si) % OCC.length];

      const tasks: Task[] = TURNOVER_TASK_TITLES.map((title) => {
        taskSeq += 1;
        return buildTask(prop, title, tStatus, checkOutOff, user(taskSeq), dept(taskSeq), taskSeq);
      });

      out.push({
        id: `res-${resSeq}`,
        property_id: prop.id,
        property_name: prop.name,
        guest_name: GUESTS[(pi + si * 7) % GUESTS.length],
        check_in: noonISO(inOff),
        check_out: noonISO(checkOutOff),
        next_check_in: si === 0 && pi % 3 === 0 ? noonISO(checkOutOff) : undefined,
        tasks,
        total_tasks: tasks.length,
        completed_tasks: tasks.filter((t) => t.status === 'complete').length,
        tasks_in_progress: tasks.filter((t) => t.status === 'in_progress').length,
        turnover_status: status,
        occupancy_status: occ,
      });
    });
  });

  return out;
}

// ---- recurring tasks (the `turnover_tasks` select response, raw shape) -------

const RECUR_TITLES = [
  'Quarterly deep clean',
  'Replace smoke-detector batteries',
  'Restock consumables',
  'Inspect HVAC filter',
  'Hot-tub service',
  'Owner statement review',
  'Window & screen check',
  'Linen inventory',
  'Pool chemical balance',
  'Pest-control walkthrough',
];

/** Returns raw `turnover_tasks` rows (pre-transform). For each of the next 7
 *  days we emit exactly one task per user (5) so the Day Kanban shows every
 *  user column populated by default; a couple of past days too. */
export function getDemoRecurringRows() {
  const rows: ReturnType<typeof buildRecurringRow>[] = [];
  let seq = 0;

  const emitDay = (dayOff: number, count: number) => {
    for (let k = 0; k < count; k++) {
      seq += 1;
      rows.push(
        buildRecurringRow(
          seq,
          PROPERTIES[(seq * 3) % PROPERTIES.length],
          RECUR_TITLES[seq % RECUR_TITLES.length],
          taskStatusFor(dayOff),
          dayOff,
          DEMO_USERS[k % DEMO_USERS.length], // one per user → balanced columns
          dept(seq),
        ),
      );
    }
  };

  for (let d = 0; d <= 6; d++) emitDay(d, DEMO_USERS.length); // 5 per day, one per user
  emitDay(-1, 3);
  emitDay(-2, 2);

  return rows;
}

function buildRecurringRow(
  seq: number,
  prop: { id: string; name: string },
  title: string,
  status: string,
  offset: number,
  u: AppUser,
  d: Department,
) {
  return {
    id: `rt-${seq}`,
    property_name: prop.name,
    template_id: `tpl-${seq}`,
    title,
    description: null,
    priority: ['low', 'medium', 'high'][seq % 3],
    bin_id: null,
    is_binned: false,
    department_id: d.id,
    status,
    scheduled_date: localDate(offset),
    scheduled_time: null,
    form_metadata: null,
    completed_at: status === 'complete' ? noonISO(offset) : null,
    created_at: noonISO(-40),
    updated_at: noonISO(-1),
    templates: { id: `tpl-${seq}`, name: title, department_id: d.id },
    departments: { id: d.id, name: d.name },
    task_assignments: [
      { user_id: u.id, users: { id: u.id, name: u.name, avatar: u.avatar ?? '', role: u.role ?? '' } },
    ],
  };
}
