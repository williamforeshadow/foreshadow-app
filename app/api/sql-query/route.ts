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
Database Tables and Columns:

cleanings table:
  - id (uuid)
  - property_name (text)
  - scheduled_start (timestamp with time zone)
  - assigned_staff (text)
  - content (text)
  - status (text)
  - metadata (jsonb)
  - created_at (timestamp with time zone)
  - updated_at (timestamp with time zone)
  - reservation_id (uuid)
  - earliest_start (timestamp with time zone)
  - latest_finish (timestamp with time zone)

reservations table:
  - id (uuid)
  - property_name (text)
  - guest_name (text)
  - check_in (timestamp with time zone)
  - check_out (timestamp with time zone)
  - created_at (timestamp with time zone)
  - updated_at (timestamp with time zone)

Relationship: cleanings.reservation_id → reservations.id
`;

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();
    
    // Generate SQL with GPT-4o-mini
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a PostgreSQL expert. Generate SQL queries based on natural language requests.

${DATABASE_SCHEMA}

Instructions:
- Return ONLY the SQL query, no markdown, no explanations, no backticks
- DO NOT include a semicolon at the end
- Use proper PostgreSQL syntax
- Add LIMIT 100 if no limit specified
- Use table aliases for clarity
- For date/time comparisons, use PostgreSQL functions like CURRENT_DATE, NOW(), INTERVAL
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

