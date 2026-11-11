import { createRepos } from "@/lib/data/repos";
import { segmentSourceChoices } from "@/lib/segment-sources";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

/** The courses, programs and events a segment can be synced from. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ sources: await segmentSourceChoices(createRepos(auth.supabase)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the sources" }, { status: 500 });
  }
}
