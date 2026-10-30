import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Small catalog table (tens of offers) — no pagination needed.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const names = await createRepos(supabase).billing.kajabiOfferNames();
    return NextResponse.json({ names });
  } catch (error) {
    console.error("Error fetching Kajabi offers:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
