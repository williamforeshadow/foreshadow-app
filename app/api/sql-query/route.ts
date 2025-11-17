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
Database Schema:

get_property_turnovers() - Property turnover cards (reservation + cleaning combined)
Returns:
  - id (uuid) - Shared ID between reservation and cleaning
  - property_name (text)
  - guest_name (text)
  - check_in (timestamptz)
  - check_out (timestamptz)
  - next_check_in (timestamptz)
  - assigned_staff (text)
  - status (text) - Cleaning status: 'pending', 'scheduled', 'in_progress', 'complete'
  - scheduled_start (timestamptz)
  - property_clean_status (text) - 'needs_cleaning', 'cleaning_scheduled', 'cleaning_complete'

cleanings table:
  - id (uuid)
  - property_name (text)
  - scheduled_start (timestamptz)
  - assigned_staff (text)
  - status (text)
  - reservation_id (uuid)
  - earliest_start (timestamptz)
  - latest_finish (timestamptz)
  - created_at (timestamptz)
  - updated_at (timestamptz)

reservations table:
  - id (uuid)
  - property_name (text)
  - guest_name (text)
  - check_in (timestamptz)
  - check_out (timestamptz)
  - created_at (timestamptz)
  - updated_at (timestamptz)
`;

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();
    
    // Get current date/time for context
    const now = new Date();
    
    // Generate SQL with GPT-4o-mini
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a PostgreSQL expert. Generate SQL queries based on natural language requests.

CURRENT DATE/TIME CONTEXT:
- Full timestamp: ${now.toISOString()}
- Current date: ${now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'America/Los_Angeles'
  })}
- Current time: ${now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    timeZone: 'America/Los_Angeles'
  })}
- Current year: ${now.getFullYear()}
- Timezone: America/Los_Angeles

${DATABASE_SCHEMA}

IMPORTANT: When the query includes '/cards', ALWAYS use get_property_turnovers() function.

EXAMPLES:
- "/cards show unassigned" → SELECT * FROM get_property_turnovers() WHERE assigned_staff IS NULL
- "/cards properties needing cleaning" → SELECT * FROM get_property_turnovers() WHERE property_clean_status = 'needs_cleaning'
- "/cards scheduled cleanings at crane" → SELECT * FROM get_property_turnovers() WHERE property_clean_status = 'cleaning_scheduled' AND property_name ILIKE '%crane%'

For queries without '/cards', you may use base tables (cleanings, reservations) for analytical questions.

Instructions:
- Return ONLY the SQL query, no markdown, no explanations, no backticks
- DO NOT include a semicolon at the end
- Use proper PostgreSQL syntax
- Add LIMIT 100 if no limit specified
- For property names, use ILIKE '%search%' for fuzzy matching
- For date/time comparisons, use PostgreSQL functions like CURRENT_DATE, NOW(), INTERVAL
- When user mentions dates without year, assume current year (${now.getFullYear()})
- When joining tables, use proper JOIN syntax`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3
    });
    
    let sqlQuery = completion.choices[0]?.message?.content?.trim() || '';
    
    // Remove markdown code blocks if present
    sqlQuery = sqlQuery.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Remove trailing semicolon (causes issues with dynamic SQL execution)
    sqlQuery = sqlQuery.replace(/;+\s*$/g, '');
    
    // Execute via Supabase RPC
    const { data, error } = await supabase.rpc('execute_dynamic_sql', {
      sql_query: sqlQuery
    });
    
    if (error) {
      return NextResponse.json({ 
        error: error.message,
        sql: sqlQuery 
      }, { status: 400 });
    }
    
    return NextResponse.json({ 
      data, 
      sql: sqlQuery 
    });
    
  } catch (err: any) {
    return NextResponse.json({ 
      error: err.message 
    }, { status: 500 });
  }
}

