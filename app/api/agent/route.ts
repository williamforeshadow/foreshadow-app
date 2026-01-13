import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// Lazy initialization to avoid build-time errors
let anthropic: Anthropic | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any = null;

function getAnthropic() {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
  }
  return anthropic;
}

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabase;
}

// Sliding window memory: number of message exchanges to remember
const MEMORY_WINDOW = 10;

const DATABASE_SCHEMA = `
## DATABASE SCHEMA

### users
Application users who can be assigned to tasks and projects.
| Column | Type | Description |
|--------|------|-------------|
| id | text | Primary key (e.g., 'test-staff-001') |
| name | text | User's display name |
| email | text | User's email (unique) |
| role | text | 'superadmin', 'manager', or 'staff' |
| avatar | text | Emoji avatar |
| created_at | timestamptz | Record creation time |

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
| status | text | Task status: 'not_started', 'in_progress', 'paused', 'complete', 'reopened' |
| scheduled_start | timestamptz | Scheduled start time |
| form_metadata | jsonb | Form responses with field labels |
| completed_at | timestamptz | When task was completed |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### task_assignments
Junction table linking tasks to assigned users (supports multiple assignees).
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| task_id | uuid | FK to turnover_tasks |
| user_id | text | FK to users |
| assigned_at | timestamptz | When assignment was made |

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
| due_date | timestamptz | Project due date |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### project_assignments
Junction table linking projects to assigned users (supports multiple assignees).
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| project_id | uuid | FK to property_projects |
| user_id | text | FK to users |
| assigned_at | timestamptz | When assignment was made |

### project_comments
Discussion comments on projects.
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| project_id | uuid | FK to property_projects |
| user_id | text | FK to users (who posted the comment) |
| comment_content | text | The comment text |
| created_at | timestamptz | Comment creation time |

## COMMON QUERY PATTERNS

1. **Today's operations**: Use CURRENT_DATE for today, CURRENT_DATE + 1 for tomorrow
2. **Same-day flips**: Properties where check_out and next check_in are same day
3. **Staff workload**: JOIN task_assignments and GROUP BY user_id
4. **Occupancy**: Compare check_in/check_out dates against date ranges
5. **Overdue tasks**: WHERE status != 'complete' AND scheduled_start < NOW()
6. **Property history**: Filter by property_name with date ranges
7. **User's assignments**: JOIN task_assignments or project_assignments WHERE user_id = 'xxx'
8. **Get assignees for a task**: SELECT u.* FROM users u JOIN task_assignments ta ON ta.user_id = u.id WHERE ta.task_id = 'xxx'

## NOTES
- Use ILIKE for case-insensitive text search
- Always include reasonable LIMIT (default 100) unless aggregating
- For date comparisons, cast to date if needed: check_in::date
- Property names are stored as text, search with ILIKE '%partial%'
- To get user names for assignments, JOIN with the users table
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

// Helper function to save assistant message
async function saveAssistantMessage(userId: string | undefined, content: string, metadata: object = {}) {
  if (!userId) return;
  try {
    await getSupabase().from("ai_chat_messages").insert({
      user_id: userId,
      role: "assistant",
      content,
      metadata,
    });
  } catch (err) {
    console.error("Failed to save assistant message:", err);
  }
}

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
    const { prompt, user_id } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid prompt" },
        { status: 400 }
      );
    }

    // --- MEMORY: Fetch recent conversation history ---
    let conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    
    if (user_id) {
      // Fetch last N messages for this user (sliding window)
      const { data: recentMessages, error: historyError } = await supabase
        .from("ai_chat_messages")
        .select("role, content")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(MEMORY_WINDOW * 2); // *2 for user + assistant pairs

      if (!historyError && recentMessages) {
        // Reverse to get chronological order (oldest first)
        conversationHistory = recentMessages.reverse().map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));
      }

      // Save the current user message
      await getSupabase().from("ai_chat_messages").insert({
        user_id,
        role: "user",
        content: prompt,
      });
    }

    // Build messages array with history + current prompt
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...conversationHistory,
      { role: "user", content: prompt },
    ];

    // Step 1: Ask Claude to determine if we need data and generate SQL
    const analysisResponse = await getAnthropic().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages,
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
      await saveAssistantMessage(user_id, analysisText, { tool_used: "conversation" });
      return NextResponse.json({
        answer: analysisText,
        tool_used: "conversation",
      });
    }

    // If no data needed, return the conversational response
    if (!analysis.needs_data) {
      await saveAssistantMessage(user_id, analysis.response, { tool_used: "conversation" });
      return NextResponse.json({
        answer: analysis.response,
        tool_used: "conversation",
      });
    }

    // Step 2: Execute the SQL query
    const sql = analysis.sql?.trim();

    if (!sql) {
      const errorMsg = "I understood your question but couldn't generate a proper query. Could you rephrase it?";
      await saveAssistantMessage(user_id, errorMsg, { tool_used: "error" });
      return NextResponse.json({
        answer: errorMsg,
        tool_used: "error",
      });
    }

    // Safety check: only SELECT
    if (!sql.toLowerCase().startsWith("select")) {
      const errorMsg = "I can only read data, not modify it. Please ask a question about your data.";
      await saveAssistantMessage(user_id, errorMsg, { tool_used: "error" });
      return NextResponse.json({
        answer: errorMsg,
        tool_used: "error",
      });
    }

    // Execute query
    const { data, error } = await getSupabase().rpc("execute_dynamic_sql", {
      sql_query: sql,
    });

    if (error) {
      // Let Claude interpret the error
      const errorResponse = await getAnthropic().messages.create({
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

      await saveAssistantMessage(user_id, errorText, { tool_used: "sql_error", sql, error: error.message });
      return NextResponse.json({
        answer: errorText,
        tool_used: "sql_error",
        sql,
        error: error.message,
      });
    }

    // Step 3: Interpret the results
    const interpretResponse = await getAnthropic().messages.create({
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

    const rowCount = Array.isArray(data) ? data.length : 0;
    await saveAssistantMessage(user_id, interpretation, { tool_used: "sql", sql, row_count: rowCount });
    
    return NextResponse.json({
      answer: interpretation,
      tool_used: "sql",
      sql,
      row_count: rowCount,
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
