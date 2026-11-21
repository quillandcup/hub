import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

type MemberResultStatus = "added" | "already_in_segment" | "not_found";

interface MemberResult {
  email: string;
  status: MemberResultStatus;
}

/** Split a pasted blob of emails on commas, whitespace, and newlines. */
function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0)
    )
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { id: segmentId } = await params;
  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = parsed;

  const emails: string[] = Array.isArray(body.emails)
    ? body.emails.map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.length > 0)
    : typeof body.text === "string"
      ? parseEmails(body.text)
      : [];

  if (emails.length === 0) {
    return NextResponse.json({ error: "No emails provided" }, { status: 400 });
  }

  const repos = createRepos(supabase);
  const segment = await repos.segments.byId(segmentId).catch(() => null);
  if (!segment) return NextResponse.json({ error: "Segment not found" }, { status: 404 });

  // Resolve emails -> member_id in batches (matches the existing
  // apply-aliases pattern of looking members up by email).
  const matchedMembers = await repos.members.byEmails(emails);
  const memberByEmail = new Map(matchedMembers.map((m) => [m.email.toLowerCase(), m]));

  const existingMemberIds = new Set(await repos.segments.memberIds(segmentId));

  const toInsert: string[] = [];
  const results: MemberResult[] = [];

  for (const email of emails) {
    const member = memberByEmail.get(email);
    if (!member) {
      results.push({ email, status: "not_found" });
      continue;
    }
    if (existingMemberIds.has(member.id)) {
      results.push({ email, status: "already_in_segment" });
      continue;
    }
    toInsert.push(member.id);
    existingMemberIds.add(member.id); // guard against duplicate emails resolving to the same member
    results.push({ email, status: "added" });
  }

  try {
    await repos.segments.addMembers(segmentId, toInsert);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add the members" }, { status: 500 });
  }

  const summary = {
    added: results.filter((r) => r.status === "added").length,
    already_in_segment: results.filter((r) => r.status === "already_in_segment").length,
    not_found: results.filter((r) => r.status === "not_found").length,
  };

  return NextResponse.json({ results, summary });
}
