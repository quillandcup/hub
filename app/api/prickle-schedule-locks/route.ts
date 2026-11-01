import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const locks = await createRepos(supabase).prickleSchedules.allLocks();
    return NextResponse.json({ locks });
  } catch (error) {
    console.error("Error fetching prickle_schedule_locks:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { month, locked, notes } = body;

    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 });
    if (typeof locked !== "boolean") return NextResponse.json({ error: "locked must be a boolean" }, { status: 400 });

    let lock;
    try {
      lock = await createRepos(supabase).prickleSchedules.setLock({
        month,
        locked,
        notes: notes || null,
        lockedBy: user.id !== "service-role" ? user.id : null,
      });
    } catch (error) {
      console.error("Error upserting prickle_schedule_lock:", error);
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }

    return NextResponse.json({ lock });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to update lock" }, { status: 500 });
  }
}
