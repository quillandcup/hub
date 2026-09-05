import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Small catalog table (tens of offers) — no pagination needed.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { data, error } = await supabase.schema("bronze").from("kajabi_offers").select("name");
  if (error) {
    console.error("Error fetching Kajabi offers:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const names = Array.from(new Set((data || []).map((o) => o.name).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  return NextResponse.json({ names });
}
