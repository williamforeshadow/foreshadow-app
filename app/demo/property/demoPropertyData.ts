// =============================================================================
// Fabricated fixtures for the public Property Profile demo (app/demo/property).
// One fully fleshed-out property — "425 W Beech St #1404" — a downtown San Diego
// bay-view condo. Covers every Knowledge sub-section (Information, Access,
// Connectivity + Tech accounts, Interior & Exterior rooms/cards, Vendors, Notes,
// Documents) plus its Tasks and Schedule. Reuses the same users / departments as
// the other demos. Zero real PII (fabricated).
//
// Photos are bundled under /public/demo-property and referenced as root-relative
// paths; resolvePublicPhotoUrl() serves those as-is (see PhotoGrid.tsx).
// =============================================================================

import { DEMO_USERS, DEMO_DEPARTMENTS } from '../schedule/demoScheduleData';

export const DEMO_PROPERTY_ID = 'demo-prop-1';

// ---- date helpers (relative to today so the schedule is always populated) ---
function isoAt(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}
function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const dept = (name: string) =>
  DEMO_DEPARTMENTS.find((d) => d.name === name) ?? DEMO_DEPARTMENTS[0];
const assignee = (i: number) => {
  const u = DEMO_USERS[i % DEMO_USERS.length];
  return { user_id: u.id, name: u.name, avatar: u.avatar ?? null, role: u.role ?? 'staff' };
};
// `file` is a bundled image under /public/demo-property.
const photo = (file: string, caption: string, sort_order: number) => ({
  id: `ph-${file}`,
  storage_path: `/demo-property/${file}`,
  caption,
  sort_order,
});

// ---------------------------------------------------------------------------
// 1. Property profile  →  GET /api/properties/:id  →  { property }
// ---------------------------------------------------------------------------
export const DEMO_PROPERTY = {
  id: DEMO_PROPERTY_ID,
  name: '425 W Beech St #1404',
  hostaway_name: 'W Beech St · Bay-View 2BR in Downtown San Diego',
  hostaway_listing_id: 184213,
  is_active: true,
  address_street: '425 W Beech St #1404',
  address_city: 'San Diego',
  address_state: 'CA',
  address_zip: '92101',
  address_country: 'USA',
  latitude: 32.7223,
  longitude: -117.1698,
  bedrooms: 2,
  bathrooms: 2,
  timezone: 'America/Los_Angeles',
  created_at: isoAt(-420),
  updated_at: isoAt(-3),
};

// ---------------------------------------------------------------------------
// 2. Access  →  GET /api/properties/:id/access  →  { items }  (property_access_items)
// ---------------------------------------------------------------------------
export function getDemoAccess() {
  const rows: Array<[string, string, string, string | null, string | null]> = [
    ['acc-entry', 'entry_code', 'Entry code (guest)', '4827', 'Rotate after every checkout from the Schlage Encode app.'],
    ['acc-team', 'team_code', 'Team / cleaner code', '9931', 'Permanent — do not change.'],
    ['acc-backup', 'backup_code', 'Backup code', '5500', null],
    ['acc-building', 'building_code', 'Building / exterior door code', '2240', null],
    ['acc-gate', 'gate_code', 'Gate code', '#1404', null],
    ['acc-elevator', 'elevator', 'Elevator', null, 'After 10pm the elevator needs the building fob — tap it, then press 14. Fob lives in the kitchen drawer.'],
    ['acc-lockbox', 'lockbox_code', 'Lockbox code', '3104', 'On the railing just left of unit 1404’s door.'],
    ['acc-key', 'key_location', 'Key location', 'Lockbox on the railing left of the door; front desk holds a spare.', null],
    ['acc-spot', 'parking_spot', 'Parking spot number', 'P2 · #114', null],
    ['acc-ptype', 'parking_type', 'Parking type', 'garage', null],
    ['acc-ploc', 'parking_location', 'Parking location / instructions', null, 'Garage fob at the gate on Cedar St (do NOT tailgate). Guest spots up front are 2-hour only.'],
  ];
  return rows.map(([id, type, label, value, notes], i) => ({
    id,
    property_id: DEMO_PROPERTY_ID,
    type,
    label,
    value,
    notes,
    sort_order: i,
    created_at: isoAt(-400),
    updated_at: isoAt(-6),
  }));
}

// ---------------------------------------------------------------------------
// 3. Connectivity  →  GET /api/properties/:id/connectivity  →  { connectivity }
// ---------------------------------------------------------------------------
export function getDemoConnectivity() {
  return {
    property_id: DEMO_PROPERTY_ID,
    wifi_ssid: 'Beech1404_5G',
    wifi_password: 'BayView!2024',
    wifi_router_location:
      'Eero in the living-room media console, behind the TV. Second node is in the hall closet.',
    created_at: isoAt(-400),
    updated_at: isoAt(-30),
  };
}

// ---- Tech accounts  →  GET /api/properties/:id/tech-accounts → { accounts } --
export function getDemoTechAccounts() {
  const base = (i: number) => ({
    property_id: DEMO_PROPERTY_ID,
    sort_order: i,
    created_at: isoAt(-300 + i),
    updated_at: isoAt(-20),
  });
  return [
    {
      id: 'tech-1',
      kind: 'streaming',
      service_name: 'Netflix',
      username: 'stay@beech1404.co',
      password: 'guestNetflix24',
      notes: 'House profile is “Guests”. Please don’t add the account to new devices.',
      property_tech_account_photos: [],
      ...base(0),
    },
    {
      id: 'tech-2',
      kind: 'tv_cable',
      service_name: 'YouTube TV',
      username: 'stay@beech1404.co',
      password: 'beechTV!2024',
      notes: 'Signed in on the living-room TV. Local San Diego channels included.',
      property_tech_account_photos: [],
      ...base(1),
    },
    {
      id: 'tech-3',
      kind: 'thermostat',
      service_name: 'Nest Thermostat',
      username: null,
      password: null,
      notes:
        'Hallway unit or the Nest app (owner-managed). Guests can adjust ±4° — it resets to schedule at checkout.',
      property_tech_account_photos: [],
      ...base(2),
    },
    {
      id: 'tech-4',
      kind: 'music',
      service_name: 'Sonos',
      username: null,
      password: null,
      notes: 'Sonos in the living room + on the balcony. Connect over WiFi with the Sonos app — no login.',
      property_tech_account_photos: [],
      ...base(3),
    },
    {
      id: 'tech-5',
      kind: 'security',
      service_name: 'Building Callbox',
      username: null,
      password: null,
      notes: 'Guests buzz unit 1404 at the Beech St lobby callbox; the app rings the host to let them in.',
      property_tech_account_photos: [],
      ...base(4),
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. Rooms + cards  →  GET /api/properties/:id/rooms?scope=  →  { rooms }
// ---------------------------------------------------------------------------
type CardSpec = {
  id: string;
  tag: 'appliance' | 'amenity' | 'safety' | 'quirk' | 'utility' | 'access' | 'other';
  title: string;
  body?: string | null;
  tag_data?: Record<string, unknown> | null;
  photos?: ReturnType<typeof photo>[];
};
type RoomSpec = {
  id: string;
  type: string;
  title: string;
  notes?: string | null;
  photos?: ReturnType<typeof photo>[];
  cards?: CardSpec[];
};

const INTERIOR_ROOMS: RoomSpec[] = [
  {
    id: 'room-kitchen',
    type: 'kitchen',
    title: 'Kitchen & Dining',
    notes: 'Galley kitchen open to the dining area. Keurig + drip coffee. Trash pull-out is left of the sink.',
    photos: [
      photo('kitchen-wide.jpg', 'Kitchen — galley, toward the dining area', 0),
      photo('kitchen-dining.jpg', 'Dining area off the kitchen', 1),
    ],
    cards: [
      {
        id: 'card-dishwasher',
        tag: 'appliance',
        title: 'Stainless Dishwasher',
        body: 'Pods are under the sink. Run on “Auto”. Keurig is on the counter — pods in the basket beside it.',
        tag_data: {
          make: 'GE',
          model: 'GDT665SSNSS',
          warranty_expiration: '2027-04-30',
        },
        photos: [photo('kitchen-dishwasher.jpg', 'Sink, dishwasher & Keurig', 0)],
      },
      {
        id: 'card-range',
        tag: 'quirk',
        title: 'Electric range — back-left coil',
        body: 'The back-left burner heats slowly and the oven runs ~15° hot. Otherwise standard electric range.',
      },
      {
        id: 'card-disposal',
        tag: 'utility',
        title: 'Garbage disposal switch',
        body: null,
        tag_data: {
          shutoff_location: 'Switch is on the wall to the RIGHT of the sink, not under it.',
          shutoff_instructions: 'If it hums but won’t spin, the reset button is on the underside of the unit.',
        },
      },
    ],
  },
  {
    id: 'room-living',
    type: 'living_room',
    title: 'Living Room',
    notes: 'Open living area with floor-to-ceiling windows and balcony access.',
    photos: [photo('living-room.jpg', 'Living room toward the balcony windows', 0)],
    cards: [
      {
        id: 'card-tv',
        tag: 'appliance',
        title: 'Wall-mounted Smart TV',
        body: 'Already set to YouTube TV. Remote is in the media-console basket. Sonos is paired for sound.',
        tag_data: { make: 'Samsung', model: 'QN55Q60C' },
        photos: [photo('smart-tv.jpg', 'Living-room TV & media console', 0)],
      },
      {
        id: 'card-blinds',
        tag: 'amenity',
        title: 'Solar shades',
        body: 'Wand on the right side of each window. The afternoon sun is strong — lower the west shades.',
      },
    ],
  },
  {
    id: 'room-primary',
    type: 'bedroom',
    title: 'Primary Bedroom',
    notes: 'King bed, city-view windows, ensuite bath.',
    photos: [photo('primary-bedroom.jpg', 'Primary bedroom with city view', 0)],
    cards: [
      {
        id: 'card-blackout',
        tag: 'amenity',
        title: 'Blackout shades',
        body: 'Separate from the living-room solar shades — pull the cord fully for total blackout.',
      },
    ],
  },
  {
    id: 'room-bed2',
    type: 'bedroom',
    title: 'Bedroom 2 / Office',
    notes: 'Queen bed plus a standing desk with dual monitors and a city-view balcony slider.',
    photos: [photo('bedroom-2.jpg', 'Second bedroom set up as an office', 0)],
    cards: [
      {
        id: 'card-desk',
        tag: 'amenity',
        title: 'Standing desk + dual monitors',
        body: null,
        tag_data: {
          access_instructions: 'Desk raises with the controller on the right leg. Monitors are HDMI — cable tucked behind.',
          restrictions: 'Please don’t unplug the monitors from power; they’re calibrated for the owner too.',
        },
      },
    ],
  },
  {
    id: 'room-bunk',
    type: 'bedroom',
    title: 'Bunk Room',
    notes: 'Built-in bunks — sleeps 4. Great for kids or extra guests.',
    photos: [photo('bunk-room.png', 'Built-in bunk beds', 0)],
    cards: [],
  },
  {
    id: 'room-utility',
    type: 'other',
    title: 'Utility & Safety',
    notes: 'The boring-but-critical stuff.',
    photos: [],
    cards: [
      {
        id: 'card-water-shutoff',
        tag: 'utility',
        title: 'Water shutoff',
        body: null,
        tag_data: {
          shutoff_location: 'Hallway access panel by the laundry closet — labeled valves for hot & cold.',
          shutoff_instructions: 'Quarter-turn clockwise to off. Building main is in the P1 garage if it’s a bigger leak.',
        },
        photos: [photo('water-shutoff.png', 'Unit water shutoff access', 0)],
      },
      {
        id: 'card-panel',
        tag: 'utility',
        title: 'Electrical panel',
        body: 'In the hall closet, breakers labeled. If an outlet dies, check the GFCI in the primary bath first.',
      },
      {
        id: 'card-detectors',
        tag: 'safety',
        title: 'Smoke / CO detectors',
        body: 'Hardwired with battery backup. Fire extinguisher is under the kitchen sink.',
        tag_data: {
          emergency_action:
            'On alarm, take the stairs (next to the elevator) and meet at the Cedar St garage entrance. Fire dept: ~4 min.',
          severity: 'high',
        },
      },
    ],
  },
];

const EXTERIOR_ROOMS: RoomSpec[] = [
  {
    id: 'room-balcony',
    type: 'patio',
    title: 'Balcony',
    notes: 'Private balcony with seating and a downtown + bay view. The best spot in the unit.',
    photos: [
      photo('balcony.jpg', 'Private balcony with seating', 0),
      photo('balcony-view.jpg', 'Bay & skyline view from the balcony', 1),
    ],
    cards: [
      {
        id: 'card-balcony',
        tag: 'amenity',
        title: 'Balcony',
        body: null,
        tag_data: {
          access_instructions: 'Sliding door off the living room — lift the latch up to unlock. Sonos reaches out here.',
          restrictions: 'HOA quiet hours 10pm. No grilling on the balcony (building rule). Keep the door closed in wind.',
        },
      },
    ],
  },
  {
    id: 'room-building',
    type: 'parking_area',
    title: 'Building & Parking',
    notes: 'Shared building amenities and the assigned garage space.',
    photos: [],
    cards: [
      {
        id: 'card-parking',
        tag: 'access',
        title: 'Garage space P2-114',
        body: 'Gate fob on the Cedar St entrance. One assigned space; do not use neighbors’ spots.',
      },
      {
        id: 'card-trash',
        tag: 'utility',
        title: 'Trash & recycling chute',
        body: 'Chute room is at the end of the 14th-floor hall. Recycling bins are inside the same room.',
      },
      {
        id: 'card-amenities',
        tag: 'amenity',
        title: 'Pool & gym (Level 3)',
        body: null,
        tag_data: {
          access_instructions: 'Same fob as the garage/elevator. Pool deck + fitness room on Level 3.',
          restrictions: 'Pool closes 10pm. No glassware on the pool deck.',
        },
      },
    ],
  },
];

export function getDemoRooms(scope: 'interior' | 'exterior') {
  const specs = scope === 'interior' ? INTERIOR_ROOMS : EXTERIOR_ROOMS;
  return specs.map((r, ri) => ({
    id: r.id,
    property_id: DEMO_PROPERTY_ID,
    scope,
    title: r.title,
    notes: r.notes ?? null,
    sort_order: ri,
    created_at: isoAt(-380 + ri),
    updated_at: isoAt(-10),
    property_room_photos: r.photos ?? [],
    property_attributes: (r.cards ?? []).map((c, ci) => ({
      id: c.id,
      property_id: DEMO_PROPERTY_ID,
      room_id: r.id,
      scope,
      tags: [c.tag],
      title: c.title,
      body: c.body ?? null,
      sort_order: ci,
      created_at: isoAt(-370 + ri + ci),
      updated_at: isoAt(-9),
      property_attribute_photos: c.photos ?? [],
    })),
  }));
}

// ---------------------------------------------------------------------------
// 5. Vendors / contacts  →  GET /api/properties/:id/contacts  →  { contacts }
// ---------------------------------------------------------------------------
export function getDemoContacts() {
  const base = (i: number) => ({
    property_id: DEMO_PROPERTY_ID,
    sort_order: i,
    created_at: isoAt(-350 + i),
    updated_at: isoAt(-12),
  });
  return [
    {
      id: 'contact-1',
      tags: ['cleaning'],
      name: 'Harbor Turnover Co.',
      role: 'Primary cleaning team (Maria’s crew)',
      phone: '+1 619 555 0142',
      email: 'dispatch@harborturnover.co',
      schedule: 'Turnovers between stays, ~2h',
      preferences: null,
      notes: '2-person crew, ~2h turnaround. Texts photos when done. Has the lockbox + garage fob. Lead: Maria.',
      ...base(0),
    },
    {
      id: 'contact-2',
      tags: ['maintenance'],
      name: 'Joe Avila — Handyman',
      role: 'General maintenance & plumbing',
      phone: '+1 619 555 0188',
      email: 'joe@avilahandyman.com',
      schedule: null,
      preferences: null,
      notes: 'Knows the building. Same-day for urgent. Registered with building security.',
      ...base(1),
    },
    {
      id: 'contact-3',
      tags: ['stakeholders'],
      name: 'Beech St HOA — Front Desk',
      role: 'Building management / concierge',
      phone: '+1 619 555 0233',
      email: 'frontdesk@beechtower.example',
      schedule: null,
      preferences: null,
      notes: 'Holds the spare fob. Notify them of any contractor visits. Move-in elevator must be reserved.',
      ...base(2),
    },
    {
      id: 'contact-4',
      tags: ['owners'],
      name: 'Linda Park',
      role: 'Owner',
      phone: '+1 619 555 0119',
      email: 'linda.park@example.com',
      schedule: null,
      preferences: 'Prefers texts. Approve anything over $250 with her first.',
      notes: null,
      ...base(3),
    },
    {
      id: 'contact-5',
      tags: ['emergency'],
      name: 'Downtown 24/7 Plumbing',
      role: 'After-hours plumbing emergencies',
      phone: '+1 619 555 0911',
      email: null,
      schedule: '24/7',
      preferences: null,
      notes: 'Burst pipe / no water → call immediately, shut the hallway valve, then text Linda + front desk.',
      ...base(4),
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. Notes  →  GET /api/properties/:id/notes  →  { notes }
// ---------------------------------------------------------------------------
export function getDemoNotes() {
  const base = (i: number) => ({
    property_id: DEMO_PROPERTY_ID,
    sort_order: i,
    created_at: isoAt(-200 + i),
    updated_at: isoAt(-5),
  });
  return [
    {
      id: 'note-1',
      scope: 'owner_preferences',
      title: 'No pets / no parties',
      body: 'Listing is set to no pets and no events — HOA enforces both. Quiet hours 10pm.',
      ...base(0),
    },
    {
      id: 'note-2',
      scope: 'owner_preferences',
      title: 'Restocking',
      body: 'Keep Keurig pods, dish pods, and toilet paper topped up — bill to the owner consumables account.',
      ...base(1),
    },
    {
      id: 'note-3',
      scope: 'known_issues',
      title: 'Primary shower runs hot',
      body: 'The primary ensuite shower spikes hot for ~10s. Cartridge on order. Warn guests in the welcome message.',
      ...base(2),
    },
    {
      id: 'note-4',
      scope: 'known_issues',
      title: 'Balcony slider sticks',
      body: 'The living-room slider can stick in humidity — lift the handle while pulling. Weatherstrip replacement scheduled.',
      ...base(3),
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. Documents  →  GET /api/properties/:id/documents  →  { documents }
// ---------------------------------------------------------------------------
export function getDemoDocuments() {
  const base = (i: number) => ({
    property_id: DEMO_PROPERTY_ID,
    created_at: isoAt(-260 + i),
    updated_at: isoAt(-14),
  });
  return [
    {
      id: 'doc-1',
      tag: 'insurance',
      title: 'STR Liability Policy 2024',
      notes: 'Covers up to $2M. Renews December.',
      storage_path: 'str-liability-2024.pdf',
      mime_type: 'application/pdf',
      size_bytes: 412_000,
      original_filename: 'STR_Liability_2024.pdf',
      ...base(0),
    },
    {
      id: 'doc-2',
      tag: 'other',
      title: 'HOA Rules & Move-in Packet',
      notes: 'Quiet hours, elevator reservation, balcony rules.',
      storage_path: 'hoa-rules.pdf',
      mime_type: 'application/pdf',
      size_bytes: 305_000,
      original_filename: 'Beech_HOA_Rules.pdf',
      ...base(1),
    },
    {
      id: 'doc-3',
      tag: 'inspection',
      title: 'Annual Safety Inspection',
      notes: 'Smoke/CO + extinguisher check — passed.',
      storage_path: 'safety-inspection.pdf',
      mime_type: 'application/pdf',
      size_bytes: 188_500,
      original_filename: 'Safety_Inspection_Mar.pdf',
      ...base(2),
    },
    {
      id: 'doc-4',
      tag: 'other',
      title: 'House Manual (guest PDF)',
      notes: 'The version we send guests at check-in.',
      storage_path: 'house-manual.pdf',
      mime_type: 'application/pdf',
      size_bytes: 980_000,
      original_filename: 'Beech_1404_House_Manual.pdf',
      ...base(3),
    },
  ];
}

// ---------------------------------------------------------------------------
// 8. Tasks  →  GET /api/properties/:id/tasks  →  { property, tasks }
//    RawTask shape consumed by components/properties/tasks/PropertyTasksView.
// ---------------------------------------------------------------------------
type TaskSpec = {
  title: string;
  deptName: string;
  status: 'paused' | 'not_started' | 'in_progress' | 'complete';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  dueOff: number | null;
  userIdx: number | null;
  automated?: boolean;
  binned?: boolean;
  reservationId?: string | null;
  guest?: string | null;
  checkInOff?: number;
  checkOutOff?: number;
  templateName?: string | null;
};

const TASK_SPECS: TaskSpec[] = [
  { title: 'Standard Turnover Clean', templateName: 'Standard Turnover Clean', deptName: 'Housekeeping', status: 'complete', priority: 'high', dueOff: -2, userIdx: 1, automated: true, reservationId: 'res-2', guest: 'The Hartleys', checkInOff: -7, checkOutOff: -2 },
  { title: 'Mid-stay refresh & towels', templateName: 'Mid-stay Refresh', deptName: 'Housekeeping', status: 'in_progress', priority: 'medium', dueOff: 0, userIdx: 3, automated: true, reservationId: 'res-3', guest: 'Priya & Sam', checkInOff: -1, checkOutOff: 4 },
  { title: 'Standard Turnover Clean', templateName: 'Standard Turnover Clean', deptName: 'Housekeeping', status: 'not_started', priority: 'high', dueOff: 4, userIdx: 1, automated: true, reservationId: 'res-3', guest: 'Priya & Sam', checkInOff: -1, checkOutOff: 4 },
  { title: 'Pre-arrival inspection', templateName: 'Pre-arrival Inspection', deptName: 'Inspection', status: 'not_started', priority: 'medium', dueOff: 6, userIdx: 4, automated: true, reservationId: 'res-4', guest: 'Marcus Bell', checkInOff: 6, checkOutOff: 11 },
  { title: 'Replace primary shower cartridge', deptName: 'Maintenance', status: 'in_progress', priority: 'high', dueOff: 1, userIdx: 2, binned: true },
  { title: 'Reseal balcony slider weatherstrip', deptName: 'Maintenance', status: 'not_started', priority: 'medium', dueOff: 3, userIdx: 2, binned: true },
  { title: 'Restock consumables (coffee, paper)', deptName: 'Housekeeping', status: 'not_started', priority: 'low', dueOff: 2, userIdx: 3, binned: true },
  { title: 'Order replacement garage fob', deptName: 'Admin', status: 'paused', priority: 'low', dueOff: null, userIdx: 0, binned: true },
  { title: 'Quarterly deep clean', templateName: 'Deep Clean', deptName: 'Housekeeping', status: 'not_started', priority: 'medium', dueOff: 12, userIdx: 1, binned: true },
  { title: 'HVAC filter swap', deptName: 'Maintenance', status: 'complete', priority: 'low', dueOff: -10, userIdx: 2, binned: true },
];

export function getDemoPropertyTasks() {
  const tasks = TASK_SPECS.map((s, i) => {
    const d = dept(s.deptName);
    const u = s.userIdx != null ? [assignee(s.userIdx)] : [];
    return {
      task_id: `pt-${i + 1}`,
      reservation_id: s.reservationId ?? null,
      property_id: DEMO_PROPERTY_ID,
      property_name: DEMO_PROPERTY.name,
      template_id: s.templateName ? `tpl-${i + 1}` : null,
      template_name: s.templateName ?? null,
      title: s.title,
      description: null,
      priority: s.priority,
      department_id: d.id,
      department_name: d.name,
      status: s.status,
      scheduled_date: s.dueOff != null ? ymd(s.dueOff) : null,
      scheduled_time: s.automated ? '11:00' : null,
      form_metadata: null,
      completed_at: s.status === 'complete' ? isoAt(s.dueOff ?? -1) : null,
      created_at: isoAt(-30 - i),
      updated_at: isoAt(-(i % 4)),
      bin_id: s.binned ? 'bin-tasks' : null,
      bin_name: s.binned ? 'Task Bin' : null,
      bin_is_system: !!s.binned,
      is_binned: !!s.binned,
      is_automated: !!s.automated,
      guest_name: s.guest ?? null,
      check_in: s.checkInOff != null ? ymd(s.checkInOff) : null,
      check_out: s.checkOutOff != null ? ymd(s.checkOutOff) : null,
      assigned_users: u,
      comment_count: 0,
    };
  });
  return { property: { id: DEMO_PROPERTY_ID, name: DEMO_PROPERTY.name }, tasks };
}

// ---------------------------------------------------------------------------
// 9. Schedule  →  GET /api/properties/:id/schedule?year&month
//    →  { property, window, reservations, tasks }
//    Returns today-centered data regardless of the requested month so the
//    demo's current-month view is always populated.
// ---------------------------------------------------------------------------
const RESERVATIONS = [
  { id: 'res-1', guest_name: 'The Okafors', inOff: -18, outOff: -12 },
  { id: 'res-2', guest_name: 'The Hartleys', inOff: -7, outOff: -2 },
  { id: 'res-3', guest_name: 'Priya & Sam', inOff: -1, outOff: 4 },
  { id: 'res-4', guest_name: 'Marcus Bell', inOff: 6, outOff: 11 },
  { id: 'res-5', guest_name: 'The Delgados', inOff: 13, outOff: 18 },
];

export function getDemoPropertySchedule() {
  const reservations = RESERVATIONS.map((r, i) => ({
    id: r.id,
    guest_name: r.guest_name,
    check_in: ymd(r.inOff),
    check_out: ymd(r.outOff),
    next_check_in: RESERVATIONS[i + 1] ? ymd(RESERVATIONS[i + 1].inOff) : null,
  }));

  const taskStatus = (off: number) =>
    off < 0 ? 'complete' : off === 0 ? 'in_progress' : 'not_started';
  const scheduleTasks = [
    ...RESERVATIONS.map((r, i) => {
      const d = dept('Housekeeping');
      return {
        task_id: `st-${i + 1}`,
        title: 'Standard Turnover Clean',
        template_name: 'Standard Turnover Clean',
        template_id: `tpl-st-${i + 1}`,
        scheduled_date: ymd(r.outOff),
        scheduled_time: '11:00',
        status: taskStatus(r.outOff),
        reservation_id: r.id,
        is_automated: true,
        assigned_users: [assignee(1)],
        property_id: DEMO_PROPERTY_ID,
        property_name: DEMO_PROPERTY.name,
        department_id: d.id,
        department_name: d.name,
        priority: 'high',
        description: null,
        form_metadata: null,
        bin_id: null,
        bin_name: null,
        is_binned: false,
        created_at: isoAt(-20),
        updated_at: isoAt(-1),
      };
    }),
    (() => {
      const d = dept('Maintenance');
      return {
        task_id: 'st-m1',
        title: 'Replace primary shower cartridge',
        template_name: null,
        template_id: null,
        scheduled_date: ymd(1),
        scheduled_time: null,
        status: 'in_progress',
        reservation_id: null,
        is_automated: false,
        assigned_users: [assignee(2)],
        property_id: DEMO_PROPERTY_ID,
        property_name: DEMO_PROPERTY.name,
        department_id: d.id,
        department_name: d.name,
        priority: 'high',
        description: null,
        form_metadata: null,
        bin_id: 'bin-tasks',
        bin_name: 'Task Bin',
        is_binned: true,
        created_at: isoAt(-6),
        updated_at: isoAt(-1),
      };
    })(),
  ];

  const now = new Date();
  return {
    property: { id: DEMO_PROPERTY_ID, name: DEMO_PROPERTY.name },
    window: {
      start: ymd(-20),
      end: ymd(25),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    },
    reservations,
    tasks: scheduleTasks,
  };
}
