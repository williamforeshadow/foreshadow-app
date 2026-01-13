import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  try {
    // Call the RPC
    const { data, error } = await getSupabaseServer().rpc("get_operational_snapshot");

    if (error) {
      return NextResponse.json(
        {
          error: "Failed to retrieve snapshot",
          details: error.message,
        },
        { status: 500 }
      );
    }

    // Normal successful response
    return NextResponse.json({
      snapshot: data,
      generated_at: new Date().toISOString(),
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Unknown error fetching snapshot" },
      { status: 500 }
    );
  }
}