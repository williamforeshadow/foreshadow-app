import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function POST(req: NextRequest) {
  try {
    const { sql } = await req.json();

    if (!sql || typeof sql !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid SQL" },
        { status: 400 }
      );
    }

    // Safety: allow only SELECT statements
    if (!sql.trim().toLowerCase().startsWith("select")) {
      return NextResponse.json(
        { error: "Only SELECT statements are allowed", sql },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer().rpc("execute_dynamic_sql", {
      sql_query: sql,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message, sql },
        { status: 500 }
      );
    }

    return NextResponse.json({ results: data, sql });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Unknown server error" },
      { status: 500 }
    );
  }
}