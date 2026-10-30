import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { templateRoute } from "@/lib/analytics/route";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * A page crashed in the browser (components/RouteError.tsx). A server error is alerted from the server,
 * but a render error in the browser never reaches it, so the error page reports it here and it goes to
 * #hub-alerts. Signed-in people only, and one alert per route every ten minutes (sendOperationsAlert),
 * so it can't be used to flood the channel. Only the route template and a short message are kept.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => undefined);
  const route = templateRoute(body?.path);
  if (!route || typeof body?.message !== "string") return NextResponse.json({ error: "Invalid report" }, { status: 400 });

  await sendOperationsAlert(createServiceRoleClient(), { type: "client_crash", route, message: body.message });
  return new NextResponse(null, { status: 204 });
}
