import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Lazy initialization to avoid build-time errors
let openai: OpenAI | null = null;

function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }
  return openai;
}

// FULL detailed schema summary (this MUST exist for SQL generation)
const DATABASE_SCHEMA_SUMMARY = `
TABLE: reservations
  id (uuid)
  property_name (text)
  guest_name (text)
  check_in (timestamptz)
  check_out (timestamptz)
  created_at (timestamptz)
  updated_at (timestamptz)

TABLE: turnover_tasks
  id (uuid)
  reservation_id (uuid)
  template_id (uuid)
  type (text)
  status (text) — 'not_started', 'in_progress', 'paused', 'complete', 'reopened'
  scheduled_start (timestamptz)
  form_metadata (jsonb) — Form responses with labels. Structure: {"field_id": {"label": "Question text", "type": "rating|text|yes-no|checkbox|photo", "value": "answer"}, template_name, property_name}
  completed_at (timestamptz)
  created_at (timestamptz)
  updated_at (timestamptz)

TABLE: task_assignments
  id (uuid)
  task_id (uuid) — FK to turnover_tasks
  user_id (text) — FK to users
  assigned_at (timestamptz)

TABLE: users
  id (text) — Primary key
  name (text)
  email (text)
  role (text) — 'superadmin', 'manager', 'staff'
  avatar (text)

TABLE: templates
  id (uuid)
  name (text)
  description (text)
  fields (jsonb)
  type (text)
  created_at (timestamptz)
  updated_at (timestamptz)

TABLE: property_templates
  property_name (text)
  template_id (uuid)
  enabled (boolean)
  created_at (timestamptz)
  updated_at (timestamptz)

RPC: get_property_turnovers()
  Returns:
    id, property_name, guest_name,
    check_in, check_out, next_check_in,
    occupancy_status, tasks (jsonb array),
    total_tasks, completed_tasks,
    tasks_in_progress, turnover_status

RPC: get_operational_snapshot()
  Returns a JSON object containing:
    checkins_today, checkouts_today,
    flips_today, turnovers_tomorrow,
    open_tasks, overdue_tasks, staff_summary
`;

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    // Get base URL from request headers for internal API calls
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;

    //
    // STEP 1 — Router decides WHICH TOOL to use
    //
    const router = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are the Foreshadow AI Router.

TOOLS:
1. snapshot_tool — for daily ops, workload, flips, next-day, summaries
2. sql_tool — for direct data lookups, filters, tasks, reservations, properties
3. none — for conversational queries

Respond ONLY in JSON:
{
  "tool": "snapshot_tool" | "sql_tool" | "none",
  "query": "description of what SQL needs to retrieve",
  "reason": "short explanation"
}
`
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const routerDecision = JSON.parse(router.choices[0].message.content || "{}");

    console.log("Router Decision:", routerDecision);

    //
    // TOOL 1 — SNAPSHOT
    //
    if (routerDecision.tool === "snapshot_tool") {
      const snapshotRes = await fetch(`${baseUrl}/api/ops-snapshot`);
      const snapshot = await snapshotRes.json();

      const interpretation = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Interpret operational snapshot JSON into natural language.",
          },
          {
            role: "user",
            content: `User question: "${prompt}"\nSnapshot:\n${JSON.stringify(snapshot)}`,
          },
        ],
      });

      return NextResponse.json({
        tool_used: "snapshot",
        answer: interpretation.choices[0].message.content,
      });
    }

    //
    // TOOL 2 — SQL GENERATION
    //
    if (routerDecision.tool === "sql_tool") {
      const sqlGen = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Generate SQL for the Foreshadow database.

Here is the schema:
${DATABASE_SCHEMA_SUMMARY}

Rules:
- Return ONLY the raw SQL query
- NO markdown code blocks (no \`\`\`)
- NO semicolons at the end
- NO explanations or comments
- SELECT statements only
- Use ILIKE for text search
- Add LIMIT 100 if none provided
- For turnovers/property data, prefer using: SELECT * FROM get_property_turnovers() WHERE property_name ILIKE '%search%'
`
          },
          {
            role: "user",
            content: routerDecision.query || prompt,
          },
        ],
      });

      // Clean up the generated SQL - remove markdown, semicolons, and whitespace
      let sql = (sqlGen.choices[0].message.content || "").trim();
      
      // Remove markdown code blocks if present
      sql = sql.replace(/^```sql?\n?/i, '').replace(/\n?```$/i, '');
      
      // Remove trailing semicolons
      sql = sql.replace(/;+\s*$/, '');
      
      // Trim again after cleanup
      sql = sql.trim();

      console.log("Generated SQL (cleaned):", sql);

      // Execute SQL
      const sqlRes = await fetch(`${baseUrl}/api/sql-query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });

      const sqlData = await sqlRes.json();

      // Interpret SQL results
      const interpretation = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Interpret SQL results into clear natural language.",
          },
          {
            role: "user",
            content: `User question: "${prompt}"\nSQL Results:\n${JSON.stringify(sqlData)}`,
          },
        ],
      });

      return NextResponse.json({
        tool_used: "sql",
        sql,
        answer: interpretation.choices[0].message.content,
      });
    }

    //
    // TOOL 3 — NONE
    //
    const fallback = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant inside Foreshadow." },
        { role: "user", content: prompt },
      ],
    });

    return NextResponse.json({
      tool_used: "none",
      answer: fallback.choices[0].message.content,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}