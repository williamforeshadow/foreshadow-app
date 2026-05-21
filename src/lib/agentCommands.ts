// Client-safe registry of the in-app chat slash commands. Imported by the
// chat UI (autocomplete menu) and the /api/agent/command endpoint
// (validation). Keep this free of server-only imports — it is bundled into
// the browser.

export interface AgentCommand {
  name: string;
  description: string;
}

export const AGENT_COMMANDS: AgentCommand[] = [
  { name: '/myassignments', description: 'Your open tasks' },
  {
    name: '/dailyoutlook',
    description: "Today's check-ins, check-outs & tasks",
  },
];

/** True when `text` (trimmed, case-insensitive) is exactly a known command. */
export function isAgentCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return AGENT_COMMANDS.some((c) => c.name === normalized);
}
