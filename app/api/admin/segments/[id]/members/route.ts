import { requireAdmin } from "@/lib/supabase/api-auth";
import { chunk } from "@/lib/supabase/paginate";
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
  const body = await request.json();

  const emails: string[] = Array.isArray(body.emails)
    ? body.emails.map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.length > 0)
    : typeof body.text === "string"
      ? parseEmails(body.text)
      : [];

  if (emails.length === 0) {
    return NextResponse.json({ error: "No emails provided" }, { status: 400 });
  }

  const { data: segment } = await supabase.from("segments").select("id").eq("id", segmentId).single();
  if (!segment) return NextResponse.json({ error: "Segment not found" }, { status: 404 });

  // Resolve emails -> member_id in batches (matches the existing
  // apply-aliases pattern of looking members up by email).
  let matchedMembers: { id: string; email: string }[] = [];
  for (const batch of chunk(emails, 500)) {
    const { data } = await supabase.from("members").select("id, email").in("email", batch);
    matchedMembers = matchedMembers.concat(data ?? []);
  }
  const memberByEmail = new Map(matchedMembers.map((m) => [m.email.toLowerCase(), m]));

  const { data: existingLinks } = await supabase
    .from("segment_members")
    .select("member_id")
    .eq("segment_id", segmentId);
  const existingMemberIds = new Set((existingLinks ?? []).map((l) => l.member_id));

  const toInsert: { segment_id: string; member_id: string }[] = [];
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
    toInsert.push({ segment_id: segmentId, member_id: member.id });
    existingMemberIds.add(member.id); // guard against duplicate emails resolving to the same member
    results.push({ email, status: "added" });
  }

  for (const batch of chunk(toInsert, 500)) {
    if (batch.length === 0) continue;
    const { error } = await supabase.from("segment_members").insert(batch);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = {
    added: results.filter((r) => r.status === "added").length,
    already_in_segment: results.filter((r) => r.status === "already_in_segment").length,
    not_found: results.filter((r) => r.status === "not_found").length,
  };

  return NextResponse.json({ results, summary });
}
