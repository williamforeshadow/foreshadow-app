// Icons for the Timeline header view-mode toggle (grid vs day-view Kanban).
// Both inherit color via `currentColor` so the active/inactive header states
// flow through unchanged.

export function RowsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="24" width="24" height="2" />
      <path d="M26,18H6V14H26v4m2,0V14a2,2,0,0,0-2-2H6a2,2,0,0,0-2,2v4a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2Z" />
      <rect x="4" y="6" width="24" height="2" />
    </svg>
  );
}

export function KanbanColumnsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.5 19.9V4.1C10.5 2.6 9.86 2 8.27 2H4.23C2.64 2 2 2.6 2 4.1V19.9C2 21.4 2.64 22 4.23 22H8.27C9.86 22 10.5 21.4 10.5 19.9Z" />
      <path d="M22 12.9V4.1C22 2.6 21.36 2 19.77 2H15.73C14.14 2 13.5 2.6 13.5 4.1V12.9C13.5 14.4 14.14 15 15.73 15H19.77C21.36 15 22 14.4 22 12.9Z" />
    </svg>
  );
}
