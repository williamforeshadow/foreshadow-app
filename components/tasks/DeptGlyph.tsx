'use client';

import * as React from 'react';
import { getDepartmentIcon } from '@/lib/departmentIcons';

// Renders a department's own icon (chosen on the Departments page). Kept as a
// module-level component, and rendered via createElement rather than a
// PascalCase local, so it isn't treated as a component created during render
// (e.g. inside an options .map()).
export function DeptGlyph({
  iconKey,
  size,
  muted,
}: {
  iconKey?: string | null;
  size: number;
  muted?: boolean;
}) {
  return React.createElement(getDepartmentIcon(iconKey), {
    size,
    strokeWidth: 1.8,
    style: { color: muted ? 'var(--task-ink-3)' : 'var(--task-ink-2)' },
    'aria-hidden': true,
  });
}
