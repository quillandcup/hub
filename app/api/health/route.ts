import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Public endpoint for external uptime monitors (e.g. UptimeRobot, BetterStack).
// No auth required -- see the isPublic check in lib/supabase/middleware.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createServiceClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { error } = await supabase.from("members").select("id").limit(1);
    if (error) throw error;

    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("Health check failed:", err);
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
