import { requireAdmin } from "@/lib/supabase/api-auth";
import { fetchResubscriptionsData } from "@/lib/resubscription-data";
import { NextRequest, NextResponse } from "next/server";

export type { ResubscribingMember, ResubscriptionCohort, ResubscriptionsData as ResubscriptionsResponse } from "@/lib/resubscription-data";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await fetchResubscriptionsData(auth.supabase);
  return NextResponse.json(data);
}
