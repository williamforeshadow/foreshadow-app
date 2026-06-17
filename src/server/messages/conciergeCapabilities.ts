import { getSupabaseServer } from '@/lib/supabaseServer';

// Concierge capability master switches. Three org-level booleans on the
// operations_settings singleton (id=1) that gate whether the concierge
// AUTONOMOUSLY proposes replies, tasks, and property knowledge from incoming
// guest messages. Read in the webhook eager-generation chokepoints
// (proposedReply / proposedTask / proposedKnowledge).
//
// "Autonomous only": these do NOT gate manual triggers — the inbox "Regenerate"
// button and the ops-agent concierge tool call the persist functions directly.
//
// Tolerant of a not-yet-applied migration: a missing table/column, a missing
// row, or any read error all degrade to "enabled" (matches the prior behavior
// where every capability ran). Mirrors loadTaskProposalSensitivity in draftTask.ts.

export interface ConciergeProposalFlags {
  reply: boolean;
  task: boolean;
  knowledge: boolean;
}

const ALL_ENABLED: ConciergeProposalFlags = { reply: true, task: true, knowledge: true };

function readBool(value: unknown): boolean {
  // Anything other than an explicit false reads as enabled.
  return value !== false;
}

const FALLBACK_REPLY_SENSITIVITY = 3;

/**
 * Org reply-proposal sensitivity (1-4): how readily the concierge drafts a reply
 * to an inbound guest message. Default 3, tolerant of a missing table/column
 * (degrades to the default). Read on the autonomous draft path to gate drafting.
 */
export async function loadReplyProposalSensitivity(): Promise<number> {
  try {
    const { data } = await getSupabaseServer()
      .from('operations_settings')
      .select('reply_proposal_sensitivity')
      .eq('id', 1)
      .maybeSingle();
    const v = (data as { reply_proposal_sensitivity?: number } | null)?.reply_proposal_sensitivity;
    if (typeof v === 'number' && v >= 1 && v <= 4) return Math.round(v);
  } catch {
    // Column/table may be missing in older environments — fall back.
  }
  return FALLBACK_REPLY_SENSITIVITY;
}

// The guest-facing concierge's read-only toolset, by tool name. The single
// source of truth for "which tools exist" — the settings UI and the per-tool
// master switches key off this list. Keep in sync with CONCIERGE_TOOLS in
// draftReply.ts.
export const CONCIERGE_TOOL_NAMES = [
  'get_property_knowledge_for_guest',
  'check_property_availability',
  'find_available_properties',
] as const;
export type ConciergeToolName = (typeof CONCIERGE_TOOL_NAMES)[number];

export type ConciergeToolFlags = Record<ConciergeToolName, boolean>;

const ALL_TOOLS_ENABLED: ConciergeToolFlags = {
  get_property_knowledge_for_guest: true,
  check_property_availability: true,
  find_available_properties: true,
};

/**
 * Per-tool master switches for the concierge's toolset, read off the
 * `concierge_tool_settings` jsonb on operations_settings (id=1). A tool is
 * enabled unless its key is explicitly false, so an absent column/row, an empty
 * map, or any read error all degrade to "every tool on" (matches the prior
 * behavior where the full toolset was always available). Read on every draft
 * path (autonomous, manual, and the test harness) so the toolset is consistent.
 */
export async function loadConciergeToolFlags(): Promise<ConciergeToolFlags> {
  try {
    const { data } = await getSupabaseServer()
      .from('operations_settings')
      .select('concierge_tool_settings')
      .eq('id', 1)
      .maybeSingle();
    const raw = (data as { concierge_tool_settings?: unknown } | null)?.concierge_tool_settings;
    if (!raw || typeof raw !== 'object') return { ...ALL_TOOLS_ENABLED };
    const map = raw as Record<string, unknown>;
    const flags = { ...ALL_TOOLS_ENABLED };
    for (const name of CONCIERGE_TOOL_NAMES) {
      if (map[name] === false) flags[name] = false;
    }
    return flags;
  } catch {
    // Column/table may be missing in older environments — fall back to all-on.
    return { ...ALL_TOOLS_ENABLED };
  }
}

export async function loadConciergeProposalFlags(): Promise<ConciergeProposalFlags> {
  try {
    const { data } = await getSupabaseServer()
      .from('operations_settings')
      .select('reply_proposal_enabled, task_proposal_enabled, knowledge_proposal_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (!data) return ALL_ENABLED;
    const row = data as Record<string, unknown>;
    return {
      reply: readBool(row.reply_proposal_enabled),
      task: readBool(row.task_proposal_enabled),
      knowledge: readBool(row.knowledge_proposal_enabled),
    };
  } catch {
    // Column/table may be missing in older environments — fall back to enabled.
    return ALL_ENABLED;
  }
}
