import type { ToolCallTrace } from '@/src/agent/dispatchTool';
import type { ConciergeSource, ConciergeTrainingRuleRef } from '@/lib/conciergeSources';

export type {
  ConciergeSource,
  ConciergeTrainingRuleRef,
  ConciergeSourcesRecord,
} from '@/lib/conciergeSources';
export { CONCIERGE_SOURCES_VERSION } from '@/lib/conciergeSources';

// What grounded a proposed reply, distilled for display.
//
// draftReply already collects a ToolCallTrace for its own dispatch loop and
// throws it away. This turns that trace — plus the always-tier training rules
// the prompt pins in without any tool call — into a small record the inbox can
// render as chips, so an operator reading a wrong draft can tell WHICH input to
// go fix.
//
// Two rules govern everything here:
//
// 1. DISTILL, NEVER COPY. get_property_knowledge_for_guest returns door codes
//    and wifi passwords (they're unlocked for the guest, not for a UI column).
//    Only counts, labels, booleans, and the dates the model asked about are
//    recorded. This module is the ONLY place tool payloads are read, so that
//    rule is enforceable by reading one file.
//
// 2. ALWAYS-ON TRAINING IS A SOURCE. Tier-'always' rules shape every reply from
//    inside the cached system prompt with no tool call to observe. Recording
//    only the trace would surface the situational rules (which arrive via
//    get_concierge_procedure) while leaving the standing ones invisible —
//    hiding the main knob an operator actually turns.

/** get_concierge_procedure isn't rendered as a tool — its results become the
 *  `procedure` chips, named from its own output. */
const PROCEDURE_TOOL = 'get_concierge_procedure';

export function buildConciergeSources(
  trace: ToolCallTrace[],
  alwaysRules: ConciergeTrainingRuleRef[],
): ConciergeSource[] {
  const sources: ConciergeSource[] = [];

  if (alwaysRules.length > 0) {
    sources.push({
      kind: 'training_always',
      count: alwaysRules.length,
      rules: alwaysRules,
    });
  }

  // Procedures dedupe by id: the model may load the same one across two passes
  // of the dispatch loop, and that's one source, not two.
  const procedures = new Map<string, string>();
  // Tools aggregate by name. The trace is flat across all loop iterations and
  // parallel calls in one turn resolve via Promise.all, so per-call ordering
  // isn't meaningful — only the totals are.
  const tools = new Map<string, { ok: boolean; calls: number; summary?: Record<string, unknown> }>();

  for (const call of trace) {
    if (call.name === PROCEDURE_TOOL) {
      if (call.output.ok) {
        for (const p of asArray(call.output.data)) {
          const id = str(p?.id);
          if (id) procedures.set(id, str(p?.title) || 'Untitled procedure');
        }
        continue;
      }
      // A failed procedure load has no title to show, so it falls through to the
      // tool aggregation and renders as a muted failed chip.
    }

    const prev = tools.get(call.name);
    const summary = call.output.ok ? summarize(call.name, call.input, call.output.data) : undefined;
    tools.set(call.name, {
      ok: (prev?.ok ?? false) || call.output.ok,
      calls: (prev?.calls ?? 0) + 1,
      // Keep the most recent successful summary — after a retry, that's the one
      // that actually reached the model.
      summary: summary ?? prev?.summary,
    });
  }

  for (const [id, title] of procedures) {
    sources.push({ kind: 'procedure', id, title });
  }
  for (const [name, agg] of tools) {
    sources.push({ kind: 'tool', name, ok: agg.ok, calls: agg.calls, summary: agg.summary });
  }

  return sources;
}

/**
 * Per-tool summary. Counts, booleans, and the dates the model asked about —
 * never a payload. The v1 UI renders chips only and ignores these; they're
 * captured now because a draft can't be re-derived later, so not recording them
 * would permanently cost every historical draft any richer display.
 */
function summarize(
  name: string,
  input: unknown,
  data: unknown,
): Record<string, unknown> | undefined {
  const d = obj(data);
  const i = obj(input);

  switch (name) {
    case 'get_property_knowledge_for_guest': {
      if (!d) return undefined;
      // Section counts only. The values inside are exactly the secrets this
      // module exists to keep out of the column.
      const facts =
        asArray(d.access).length +
        asArray(d.contacts).length +
        asArray(d.documents).length +
        asArray(d.tech_accounts).length +
        asArray(d.rooms).length +
        asArray(d.attributes).length +
        (d.connectivity ? 1 : 0);
      return {
        facts,
        // Listing pages are public, so presence is safe to record. The url itself
        // still isn't stored — the chip has no use for it.
        listing_link: Boolean(d.listing_link),
        empty: Boolean(d.empty),
      };
    }
    case 'check_property_availability': {
      if (!d) return undefined;
      return dropUndefined({
        mode: str(d.mode) || undefined,
        check_in: str(i?.check_in) || undefined,
        check_out: str(i?.check_out) || undefined,
        from: str(i?.from) || undefined,
        to: str(i?.to) || undefined,
        available: typeof d.available === 'boolean' ? d.available : undefined,
        windows: asArray(d.available_windows).length || undefined,
        min_nights: typeof d.min_nights === 'number' ? d.min_nights : undefined,
        meets_stay_rules:
          typeof d.meets_stay_rules === 'boolean' ? d.meets_stay_rules : undefined,
      });
    }
    case 'find_available_properties': {
      // Returns an array of listings. Only how many were offered — the urls and
      // titles belong to the reply, not to this record.
      return dropUndefined({
        returned: asArray(data).length,
        check_in: str(i?.check_in) || undefined,
        check_out: str(i?.check_out) || undefined,
        from: str(i?.from) || undefined,
        to: str(i?.to) || undefined,
      });
    }
    default:
      return undefined;
  }
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): Array<Record<string, unknown> | null> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown> | null>) : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function dropUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
