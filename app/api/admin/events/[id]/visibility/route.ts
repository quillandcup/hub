import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { clock } from "@/lib/clock";

/**
 * Hides an event from members or shows it again (`{ hidden: true | false }`). A hidden event is kept,
 * so the calendar sync doesn't make it again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (typeof body.hidden !== "boolean") return NextResponse.json({ error: "hidden must be true or false" }, { status: 400 });

  let event;
  try {
    event = await createRepos(supabase).events.setDeletedAt(id, body.hidden ? new Date(clock.now()).toISOString() : null);
  } catch (error) {
    console.error("Error changing whether an event is hidden:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update event" }, { status: 500 });
  }
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json({ event });
}
