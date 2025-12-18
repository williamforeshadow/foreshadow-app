import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// Debug: Log if API key is present
console.log("ANTHROPIC_API_KEY present:", !!process.env.ANTHROPIC_API_KEY);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATABASE_SCHEMA = `
## DATABASE SCHEMA

### reservations
Guest booking records for properties.
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| property_name | text | Name of the property |
| guest_name | text | Name of the guest |
| check_in | timestamptz | Check-in date/time |
| check_out | timestamptz | Check-out date/time |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### turnover_tasks
Tasks associated with turnovers (cleanings, maintenance between guests).
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| reservation_id | uuid | FK to reservations |
| template_id | uuid | FK to templates |
| type | text | Task type (e.g., 'cleaning', 'maintenance') |
| status | text | Task status |
| assigned_staff | text | Name of assigned staff member |
| scheduled_start | timestamptz | Scheduled start time |
| card_actions | text | Action state: 'not_started', 'in_progress', 'paused', 'completed' |
| form_metadata | jsonb | Form responses with field labels. Each field is stored as: {"field_id": {"label": "Human readable question", "type": "rating|text|yes-no|checkbox|photo", "value": "the answer"}}. Also contains template_name and property_name. |
| completed_at | timestamptz | When task was completed |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### templates
Reusable templates for tasks and forms.
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Template name |
| description | text | Template description |
| fields | jsonb | Field definitions for forms |
| type | text | Template type |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### property_templates
Junction table linking properties to their enabled templates.
| Column | Type | Description |
|--------|------|-------------|
| property_name | text | Property name |
| template_id | uuid | FK to templates |
| enabled | boolean | Whether template is active for property |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### property_projects
Capital/renovation projects for properties.
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| property_name | text | Property name |
| title | text | Project title |
| description | text | Project description |
| status | text | 'not_started', 'in_progress', 'on_hold', 'complete' |
| priority | text | 'low', 'medium', 'high', 'urgent' |
| assigned_staff | text | Assigned staff member |
| due_date | timestamptz | Project due date |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### project_comments
Discussion comments on projects.
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| project_id | uuid | FK to property_projects |
| user_name | text | Name of commenter |
| comment_content | text | The comment text |
| created_at | timestamptz | Comment creation time |

## COMMON QUERY PATTERNS

1. **Today's operations**: Use CURRENT_DATE for today, CURRENT_DATE + 1 for tomorrow
2. **Same-day flips**: Properties where check_out and next check_in are same day
3. **Staff workload**: GROUP BY assigned_staff with COUNT
4. **Occupancy**: Compare check_in/check_out dates against date ranges
5. **Overdue tasks**: WHERE card_actions != 'completed' AND scheduled_start < NOW()
6. **Property history**: Filter by property_name with date ranges

## NOTES
- Use ILIKE for case-insensitive text search
- Always include reasonable LIMIT (default 100) unless aggregating
- For date comparisons, cast to date if needed: check_in::date
- Property names are stored as text, search with ILIKE '%partial%'
`;

const SYSTEM_PROMPT = `You are Claude, an AI assistant made by Anthropic, integrated into Foreshadow - a vacation rental property management application. Your job is to answer questions about operations, properties, tasks, and projects by querying the database.

If asked about yourself, you are Claude (specifically Claude Sonnet), created by Anthropic. Do not claim to be any other AI model.

${DATABASE_SCHEMA}

## YOUR TASK

When the user asks a question:
1. Determine if it requires database data or is conversational
2. If it needs data, generate a SQL query to answer it
3. You can ONLY generate SELECT statements (read-only)

## RESPONSE FORMAT

If the question needs database data, respond with ONLY a JSON object:
{
  "needs_data": true,
  "sql": "SELECT ...",
  "reasoning": "Brief explanation of what this query does"
}

If the question is conversational or doesn't need data:
{
  "needs_data": false,
  "response": "Your conversational response here"
}

## SQL GUIDELINES
- SELECT statements only
- Use ILIKE for text searches
- Include LIMIT 100 unless doing aggregations
- Use proper date functions: CURRENT_DATE, NOW(), intervals
- For "tomorrow" use CURRENT_DATE + 1
- For "this week" use date_trunc('week', CURRENT_DATE)
- Join tables as needed to get complete information
- Return relevant columns, not always SELECT *`;

const INTERPRETATION_PROMPT = `You are Claude, an AI assistant made by Anthropic, integrated into Foreshadow - a vacation rental property management app.

The user asked a question and we ran a SQL query to get data. Now interpret the results in clear, helpful natural language.

Guidelines:
- Be concise but complete
- Highlight important findings
- If results are empty, say so clearly
- Use specific numbers and names from the data
- Format lists nicely if there are multiple items
- If there's an error, explain what might have gone wrong`;

export async function POST(req: NextRequest) {
  console.log("=== Agent API called ===");
  
  // Check if API key is available
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set!");
    return NextResponse.json(
      { error: "Server configuration error: Missing API key" },
      { status: 500 }
    );
  }
  
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid prompt" },
        { status: 400 }
      );
    }

    // Step 1: Ask Claude to determine if we need data and generate SQL
    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const analysisText = analysisResponse.content[0].type === "text"
      ? analysisResponse.content[0].text
      : "";

    // Parse the JSON response
    let analysis;
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      // If parsing fails, treat as conversational
      return NextResponse.json({
        answer: analysisText,
        tool_used: "conversation",
      });
    }

    // If no data needed, return the conversational response
    if (!analysis.needs_data) {
      return NextResponse.json({
        answer: analysis.response,
        tool_used: "conversation",
      });
    }

    // Step 2: Execute the SQL query
    const sql = analysis.sql?.trim();

    if (!sql) {
      return NextResponse.json({
        answer: "I understood your question but couldn't generate a proper query. Could you rephrase it?",
        tool_used: "error",
      });
    }

    // Safety check: only SELECT
    if (!sql.toLowerCase().startsWith("select")) {
      return NextResponse.json({
        answer: "I can only read data, not modify it. Please ask a question about your data.",
        tool_used: "error",
      });
    }

    // Execute query
    const { data, error } = await supabase.rpc("execute_dynamic_sql", {
      sql_query: sql,
    });

    if (error) {
      // Let Claude interpret the error
      const errorResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `The user asked: "${prompt}"

I tried to run this SQL: ${sql}

But got this error: ${error.message}

Please explain what went wrong and suggest how the user might rephrase their question.`,
          },
        ],
        system: INTERPRETATION_PROMPT,
      });

      const errorText = errorResponse.content[0].type === "text"
        ? errorResponse.content[0].text
        : "An error occurred while querying the database.";

      return NextResponse.json({
        answer: errorText,
        tool_used: "sql_error",
        sql,
        error: error.message,
      });
    }

    // Step 3: Interpret the results
    const interpretResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `User question: "${prompt}"

SQL query executed: ${sql}

Results (${Array.isArray(data) ? data.length : 0} rows):
${JSON.stringify(data, null, 2)}

Please provide a clear, helpful answer to the user's question based on these results.`,
        },
      ],
      system: INTERPRETATION_PROMPT,
    });

    const interpretation = interpretResponse.content[0].type === "text"
      ? interpretResponse.content[0].text
      : "I retrieved the data but couldn't interpret it.";

    return NextResponse.json({
      answer: interpretation,
      tool_used: "sql",
      sql,
      row_count: Array.isArray(data) ? data.length : 0,
    });

  } catch (err: any) {
    console.error("=== Agent error ===");
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    console.error("Full error:", JSON.stringify(err, null, 2));
    return NextResponse.json(
      { error: err.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
