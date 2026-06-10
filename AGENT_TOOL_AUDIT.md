# Agent Tool Audit — Handoff Brief

> **For a fresh agent session.** This is a self-contained brief to audit the Foreshadow ops-agent tool suite for correctness footguns, fix what's found, and add a regression test. You do not need prior conversation context — everything you need is here.

## Why this exists (intent)

The ops agent (`src/agent/runAgent.ts`, model `claude-sonnet-4-6`, temperature 0) answers operator questions by calling **tools**. A real failure prompted this audit:

> Operator asked "who was the **last** guest at 120 Island?" The agent called `find_reservations({ past: true, limit: 1 })` and returned **Joan** (Jan 1–Apr 1) instead of **Anthony** (Apr 5–Jun 6, the actual last). Worse, across follow-ups it flip-flopped, ignored a `truncated: true` flag, and — when asked to explain itself — **confabulated** that it "hadn't called tools," which the saved `tool_calls` metadata flatly disproves.

The root cause was **ours, not the model's**. Here is the architecture point that makes this audit matter:

**The model does not write SQL. It only chooses a tool and fills in parameters we defined. Our hard-coded handler turns those params into a fixed query.** The model's entire output for that call was `{name, input}`. Our `findReservations.ts` handler hard-coded `ORDER BY check_in ASC`, so `limit: 1` deterministically returned the *oldest* past stay. The model had no "sort newest-first" lever and no SQL escape hatch — it could only do what our handler allowed.

**Consequence:** the tools are the deterministic foundation the whole agent rides on. The model can only be as accurate as the levers and defaults we hard-code. If a default is wrong, the model **cannot compensate**. So tool quality is entirely on us, and these bugs are findable and fixable in our handlers. The parameterized-handler design is good and intentional (it's the safety boundary — the model can't run arbitrary SQL, leak data, or wreck tables); we are **not** changing that. We are making the handlers *super accurate*.

**Goal of this session:** systematically find this class of bug across all tools, fix them without changing the parameterized-handler model, and leave behind a golden-query regression test so they don't recur.

### The fix already applied (worked example — study this, then look for more like it)
`src/agent/tools/findReservations.ts` was fixed: added a `sort: 'most_recent' | 'earliest'` parameter, defaulting to `most_recent` when `past=true` (else `earliest`), and the resolved order is now echoed in `meta.sort`. This makes "last guest" correct by default while keeping "first guest" expressible (`sort:'earliest'`) — a single hard-coded direction can't serve both, so the fix is *a sensible default + an explicit lever + transparency in meta*, not just flipping the sort. Use this as the template for similar fixes.

## Architecture you need to know

- **Tool registry:** `src/agent/tools/index.ts` (the `TOOLS` array). 38 tools.
- **Tool shape:** `src/agent/tools/types.ts` — each tool is a `ToolDefinition` with `name`, `description`, a zod `inputSchema`, a hand-written `jsonSchema` (what the model sees), and a `handler(input, ctx)` returning a uniform `ToolResult` envelope (`{ ok: true, data, meta }` or `{ ok: false, error }`). Tools never throw to the model.
- **Dispatch:** `src/agent/dispatch.ts` / `src/agent/dispatchTool.ts` — validates input against the zod schema, runs the handler, wraps the result. Generic; you won't need to change it.
- **DB access:** handlers use `getSupabaseServer()` (service-role) and the Supabase query builder (`.from().select().eq().order().limit()` etc.). No raw SQL.
- **meta:** list tools return `{ returned, limit, truncated, ... }`. `truncated: true` means more rows existed than `limit` allowed — a critical signal the model sometimes ignores.
- **Verifying against real data:** the Supabase project is `oybwoawidkryladoyyyf`. Use the Supabase MCP `execute_sql` (read-only `SELECT`) to confirm expected answers. **Do not** run destructive SQL. The `apply_migration` tool requires explicit user authorization — do not apply migrations without asking.

## The audit checklist (apply to every tool)

Each item below is a real failure mode. For each tool, check and record findings:

1. **Ordering vs. intent.** Is the hard-coded `.order()` matched to likely query phrasings ("last / first / next / most recent / soonest / latest")? When both directions are plausible (anything time-based), is there a `sort` lever and a sensible default? Is the resolved order exposed in `meta`? *(This is the bug we already fixed in `findReservations`.)*
2. **limit / truncation footguns.** Does `limit: 1` against a fixed sort return a surprising row? Is `truncated` surfaced, and does the description tell the model to *widen* the query when it wants "the most/least/last X" rather than trust `limit: 1`?
3. **Date-bucket boundaries.** For tools with `past/upcoming/current` or date ranges: do `lt/lte/gt/gte` match the documented inclusive/exclusive semantics? Off-by-one at the boundary?
4. **Timezone / "today".** Does the tool honor a caller-supplied `reference_date` / client timezone, or silently default to server UTC and drift across midnight? Is that documented?
5. **Fabricated-id handling.** When the model passes a hallucinated-but-valid-looking UUID, does the tool return a loud `not_found` (good — see `findReservations`/`findTasks` FK pre-validation) or a silent empty result that reads as "definitively none" (bad)?
6. **Null handling.** `nullsFirst/nullsLast` on every `.order()`; null dates feeding computed fields (e.g. nights); null guest/property names.
7. **Search-term sanitization.** Any `ilike`/`.or()` on user/model text must strip `% _ , ( ) \` (see `sanitizeSearchTerm` in `findReservations.ts`/`findProperties.ts`). Missing sanitization = broken or injectable filters.
8. **Documented-quirk traps.** Stale denormalized snapshots, "no status column — cancellations are deletions," enum mismatches, etc. Does the description warn the model where reality is surprising?

For **write tools** (the `preview*` / `commit*` / `create*` / `update*` / `delete*` pairs), also check: does `preview` accurately describe what `commit` will do? Is the confirmation-token flow intact? Can a batch partially fail and mislead the model into claiming full success?

## Scope — the 38 tools

**Read / find (priority — these answer questions and are golden-test-able):**
`findProperties`, `findReservations` *(fixed)*, `findTasks`, `findUsers`, `findTemplates`, `findDepartments`, `findBins`, `findConversations`, `readConversationThread`, `findConciergeTraining`, `getPropertyKnowledge`, `getPropertyKnowledgeForGuest`.

**Write (preview/commit pairs — audit for correctness + the confirm flow):**
`previewTask`/`createTask`, `previewBin`/`createBin`, `previewTasksBatch`/`createTasksBatch`, `previewTaskUpdate`/`updateTask`, `previewTasksUpdateBatch`/`updateTasksBatch`, `previewTaskDelete`/`deleteTask`, `previewComment`/`addComment`, `previewPropertyNoteUpsert`/`commitPropertyNoteUpsert`, `previewPropertyNoteDelete`/`commitPropertyNoteDelete`, `previewPropertyContactUpsert`/`commitPropertyContactUpsert`, `previewPropertyContactDelete`/`commitPropertyContactDelete`, `previewPropertyKnowledgeWrite`/`commitPropertyKnowledgeWrite`, `previewSlackFileAttachment`/`commitSlackFileAttachment`.

**Delegation:** `concierge` (runs the guest-facing Concierge sub-agent; read its handler but its internals are out of scope here).

## Deliverable

1. **Findings table** — `tool | issue (which checklist item) | severity (high/med/low) | suggested fix`. High = wrong answers for common queries (like the `find_reservations` bug). Be concrete; cite the line.
2. **Fixes** — apply the high/medium fixes using the `find_reservations` template (sensible default + explicit lever + transparency in `meta` + clearer description). Do NOT change the parameterized-handler architecture. Keep changes minimal and typecheck (`npx tsc --noEmit`) / build (`npm run build`) green.
3. **Golden-query regression test** — a test (or runnable script) over the read tools: a set of plain-English questions with **known** correct answers verified against the live DB (e.g. *"last guest at 120 Island" → Anthony DiBlasi*; *"first guest at 120 Island" → Joan Nambuba*), asserting on tool output. This is the durable artifact that stops regressions. Write-tool tests need a seeded/transactional fixture — scope those as a second pass, don't hit live data with writes.

## How to execute

The volume (38 tools) suits a **parallel audit**: fan out a few sub-agents, each auditing a slice against the checklist above, each returning a structured findings list, then synthesize one table and apply fixes. If running this as a workflow, the user must explicitly opt in. Otherwise, audit sequentially read-tools-first (they're the highest-value and easiest to golden-test).

## Guardrails
- The audit itself is **read-only** (reading handler code + `SELECT`-only DB checks). Get authorization before any migration or write.
- Preserve existing behavior except where it's a confirmed bug; note any behavior change in the findings.
- Don't widen the model's power (no raw-SQL tool, no removing the confirm flow) — accuracy, not capability, is the goal.
