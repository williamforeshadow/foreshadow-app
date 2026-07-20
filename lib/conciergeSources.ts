// What grounded a Concierge draft — the shared shape, plus how it reads on screen.
//
// Types live here (not beside the builder in src/server/messages/conciergeSources.ts)
// because the inbox renders them in a client component, and lib/ is this repo's
// client-safe layer. The builder stays server-side: it's the only thing that
// touches raw tool payloads.

/** A training rule reduced to what a chip needs. */
export interface ConciergeTrainingRuleRef {
  id: string;
  title: string;
}

export type ConciergeSource =
  /** Tier-'always' rules, pinned into the prompt on every draft. Aggregated —
   *  they're identical draft to draft, so per-rule chips would be pure noise. */
  | { kind: 'training_always'; count: number; rules: ConciergeTrainingRuleRef[] }
  /** A situational procedure the model chose to load for THIS message. The
   *  high-signal source, so each gets its own titled chip. */
  | { kind: 'procedure'; id: string; title: string }
  /** Any other concierge tool, aggregated across the draft's dispatch loop. */
  | {
      kind: 'tool';
      name: string;
      /** True when at least one call succeeded — a retry that worked still grounded the reply. */
      ok: boolean;
      calls: number;
      summary?: Record<string, unknown>;
    };

export interface ConciergeSourcesRecord {
  version: number;
  sources: ConciergeSource[];
}

export const CONCIERGE_SOURCES_VERSION = 1 as const;

/**
 * Operator-facing tool names. The stored record keeps the raw tool name so a
 * rename here never invalidates history; anything unmapped falls back to a
 * humanized form rather than rendering a snake_case identifier at a user.
 */
const TOOL_LABELS: Record<string, string> = {
  get_property_knowledge_for_guest: 'Property knowledge',
  check_property_availability: 'Availability',
  find_available_properties: 'Other properties',
  get_concierge_procedure: 'Procedure',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * One plain line describing what a tool actually did, from the summary captured
 * at draft time. Falls back to a bare statement when a tool has no summary (an
 * older record, or a tool the distiller doesn't summarize) — never invents detail.
 */
export function toolSummaryLine(source: Extract<ConciergeSource, { kind: 'tool' }>): string {
  if (!source.ok) return 'The lookup failed';
  const s = source.summary;
  if (!s) return 'Used while drafting';

  const range = dateRange(s);
  switch (source.name) {
    case 'get_property_knowledge_for_guest': {
      if (s.empty === true) return 'No guest-visible facts on file';
      const facts = typeof s.facts === 'number' ? s.facts : null;
      const parts = [facts === null ? 'Read property facts' : `Read ${facts} guest-visible fact${facts === 1 ? '' : 's'}`];
      if (s.listing_link === true) parts.push('booking link available');
      return parts.join(' · ');
    }
    case 'check_property_availability': {
      const parts: string[] = [range ? `Checked ${range}` : 'Checked availability'];
      if (s.available === false) parts.push('not available');
      else if (s.available === true) parts.push('available');
      if (typeof s.windows === 'number' && s.windows > 0) {
        parts.push(`${s.windows} opening${s.windows === 1 ? '' : 's'}`);
      }
      if (s.meets_stay_rules === false && typeof s.min_nights === 'number') {
        parts.push(`under the ${s.min_nights}-night minimum`);
      }
      return parts.join(' · ');
    }
    case 'find_available_properties': {
      const n = typeof s.returned === 'number' ? s.returned : null;
      const head =
        n === null ? 'Searched other properties'
        : n === 0 ? 'Found no other properties open'
        : `Found ${n} other propert${n === 1 ? 'y' : 'ies'}`;
      return range ? `${head} · ${range}` : head;
    }
    default:
      return 'Used while drafting';
  }
}

/** "Aug 5 → Aug 8" from whichever date pair a summary carries. */
function dateRange(s: Record<string, unknown>): string | null {
  const a = typeof s.check_in === 'string' ? s.check_in : typeof s.from === 'string' ? s.from : null;
  const b = typeof s.check_out === 'string' ? s.check_out : typeof s.to === 'string' ? s.to : null;
  if (!a || !b) return null;
  return `${shortDate(a)} → ${shortDate(b)}`;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[m - 1]} ${d}`;
}
