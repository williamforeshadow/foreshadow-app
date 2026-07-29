// Shared status → background map for Timeline surfaces (grid cell icons,
// task-row status dots, MonthGrid). Kept in its own module so both
// ScheduledItemsCell and TaskRowList can use it without an import cycle.
//
// These were previously "marble" stacks — four gradient highlights layered
// over the base hue. At chip size (18–22px) the frosting never resolved into
// a texture; it just lit the top-left corner and washed the hue out, which in
// dark mode left the four statuses harder to tell apart than a flat fill
// makes them.
//
// The four then came down as a set against the darkened grid: every channel
// scaled by 0.87, which drops lightness uniformly while leaving hue and the
// relative spacing between rungs exactly where they were. not_started took an
// extra step first (from the ramp's #A78BFA), since flat fill had left the
// lightest rung reading as a bright lilac slab.
export const statusBackground: Record<string, string> = {
  not_started: '#795DC3',
  in_progress: '#5659D2',
  paused: '#796E92',
  complete: '#423F5B',
};
