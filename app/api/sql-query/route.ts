import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DATABASE_SCHEMA = `
Foreshadow Database Schema (Clean, Current, AI-Ready)

Primary RPC:
get_property_turnovers() - Returns the operational turnover snapshot for each reservation.

Fields returned by get_property_turnovers():
  - id (uuid)                -- reservation id
  - property_name (text)
  - guest_name (text)
  - check_in (timestamptz)
  - check_out (timestamptz)
  - next_check_in (timestamptz)
  - occupancy_status (text)  -- 'occupied' or 'vacant'
  - tasks (jsonb)            -- array of turnover task objects
  - total_tasks (integer)
  - completed_tasks (integer)
  - tasks_in_progress (integer)
  - turnover_status (text)   -- 'no_tasks', 'not_started', 'in_progress', 'complete'

Each task object inside "tasks" has:
  - task_id (uuid)
  - template_id (uuid)
  - template_name (text)
  - type (text)              -- 'cleaning', 'maintenance', 'inspection', etc.
  - status (text)            -- 'not_started', 'in_progress', 'complete'
  - assigned_staff (text)
  - scheduled_start (timestamptz)
  - card_actions (text)
  - form_metadata (jsonb)
  - completed_at (timestamptz)

----------------------------------------------------
Base Tables
----------------------------------------------------

reservations:
  - id (uuid)
  - property_name (text)
  - guest_name (text)
  - check_in (timestamptz)
  - check_out (timestamptz)
  - created_at (timestamptz)
  - updated_at (timestamptz)

turnover_tasks:
  - id (uuid)
  - reservation_id (uuid)
  - template_id (uuid)
  - type (text)
  - status (text)            -- 'not_started', 'in_progress', 'complete'
  - assigned_staff (text)
  - scheduled_start (timestamptz)
  - card_actions (text)
  - form_metadata (jsonb)
  - completed_at (timestamptz)
  - created_at (timestamptz)
  - updated_at (timestamptz)

templates (task templates):
  - id (uuid)
  - name (text)
  - description (text)
  - fields (jsonb)
  - type (text)
  - created_at (timestamptz)
  - updated_at (timestamptz)

property_templates:
  - property_name (text)
  - template_id (uuid)
  - enabled (boolean)
  - created_at (timestamptz)
  - updated_at (timestamptz)
`;

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const now = new Date();

    //
    // CHAIN-OF-THOUGHT: Intent + SQL in one call
    //
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a PostgreSQL expert for the Foreshadow property management system.

STEP 1: First, analyze the user's question and create a structured intent:
{
  "entity": "turnovers" | "tasks" | "reservations" | "templates",
  "filters": { key-value pairs for constraints },
  "reasoning": "brief explanation of what data is needed"
}

STEP 2: Then generate the SQL query based on that intent.

Current context:
- Today: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })}
- Year: ${now.getFullYear()}
- Timezone: America/Los_Angeles

${DATABASE_SCHEMA}

QUERY PATTERNS:

1. entity = "turnovers" (property overview, occupancy, turnover status):
   SELECT * FROM get_property_turnovers() WHERE ...

2. entity = "tasks" (specific task queries, staff assignments, cleanings):
   SELECT * FROM turnover_tasks WHERE type = 'cleaning' AND assigned_staff ILIKE '%name%'

3. For filtering tasks within turnovers:
   SELECT t.property_name, t.guest_name, task
   FROM get_property_turnovers() t, jsonb_array_elements(t.tasks) AS task
   WHERE task->>'assigned_staff' ILIKE '%Grace%'
   AND task->>'status' = 'complete'

4. entity = "reservations":
   SELECT * FROM reservations WHERE ...

OUTPUT FORMAT (you MUST follow this exactly):
---INTENT---
{your JSON intent here}
---SQL---
{your SQL query here, no backticks, no semicolon}

RULES:
- Use ILIKE for case-insensitive text matching
- Use proper date functions (CURRENT_DATE, NOW(), INTERVAL)
- Add LIMIT 100 if no limit specified
- Do NOT include semicolons or markdown backticks in SQL`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3
    });

    const responseText = completion.choices[0].message.content || '';
    
    // Parse out the intent and SQL from the response
    let intent = null;
    let sqlQuery = '';
    
    // Extract intent
    const intentMatch = responseText.match(/---INTENT---\s*([\s\S]*?)\s*---SQL---/);
    if (intentMatch) {
      try {
        intent = JSON.parse(intentMatch[1].trim());
      } catch (e) {
        // Intent parsing failed, but we can still try to get SQL
        intent = { raw: intentMatch[1].trim() };
      }
    }
    
    // Extract SQL
    const sqlMatch = responseText.match(/---SQL---\s*([\s\S]*?)$/);
    if (sqlMatch) {
      sqlQuery = sqlMatch[1].trim();
    }
    
    // Fallback: if no markers found, try to extract SQL directly
    if (!sqlQuery) {
      sqlQuery = responseText.replace(/```sql\n?/gi, '').replace(/```\n?/g, '').trim();
    }
    
    // Clean up SQL
    sqlQuery = sqlQuery.replace(/;+\s*$/g, '').trim();

    // SQL SAFETY CHECK — only allow SELECT
    if (!sqlQuery || !sqlQuery.toLowerCase().startsWith("select")) {
      return NextResponse.json(
        { error: "Unsafe SQL rejected", sql: sqlQuery || 'N/A', intent, rawResponse: responseText },
        { status: 400 }
      );
    }

    //
    // EXECUTE SQL AGAINST SUPABASE
    //
    const { data, error } = await supabase.rpc("execute_dynamic_sql", { sql_query: sqlQuery });

    if (error) {
      return NextResponse.json(
        { error: "Database error", details: error.message, sql: sqlQuery, intent },
        { status: 500 }
      );
    }

    //
    // RETURN RESULTS
    //
    return NextResponse.json({
      intent,
      sql: sqlQuery,
      results: data
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
