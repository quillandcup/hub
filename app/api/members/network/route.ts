import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Calculate member network connections based on prickle co-attendance
 * Returns nodes (members) and edges (connections weighted by frequency)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all active members
    const { data: members } = await supabase
      .from("members")
      .select("id, name, email, status")
      .eq("status", "active")
      .order("name");

    if (!members || members.length === 0) {
      return NextResponse.json({
        nodes: [],
        edges: [],
      });
    }

    // Get all attendance records with prickle info
    const { data: attendance } = await supabase
      .from("attendance")
      .select(`
        member_id,
        prickle_id,
        prickles!inner(
          id,
          start_time
        )
      `)
      .order("prickle_id");

    if (!attendance || attendance.length === 0) {
      return NextResponse.json({
        nodes: members.map(m => ({
          id: m.id,
          name: m.name,
          email: m.email,
          totalPrickles: 0,
        })),
        edges: [],
      });
    }

    // Group attendance by prickle_id to find co-attendees
    const prickleAttendees = new Map<string, Set<string>>();
    attendance.forEach(record => {
      if (!prickleAttendees.has(record.prickle_id)) {
        prickleAttendees.set(record.prickle_id, new Set());
      }
      prickleAttendees.get(record.prickle_id)!.add(record.member_id);
    });

    // Count total prickles per member
    const memberPrickleCounts = new Map<string, number>();
    attendance.forEach(record => {
      memberPrickleCounts.set(
        record.member_id,
        (memberPrickleCounts.get(record.member_id) || 0) + 1
      );
    });

    // Calculate connection strength between all member pairs
    const connections = new Map<string, number>();

    for (const attendeeSet of prickleAttendees.values()) {
      const attendeeList = Array.from(attendeeSet);

      // For each pair of attendees at this prickle
      for (let i = 0; i < attendeeList.length; i++) {
        for (let j = i + 1; j < attendeeList.length; j++) {
          const member1 = attendeeList[i];
          const member2 = attendeeList[j];

          // Create a consistent key (sorted to avoid duplicates)
          const key = [member1, member2].sort().join("||");

          connections.set(key, (connections.get(key) || 0) + 1);
        }
      }
    }

    // Build nodes array
    const nodes = members.map(m => ({
      id: m.id,
      name: m.name,
      email: m.email,
      totalPrickles: memberPrickleCounts.get(m.id) || 0,
    }));

    // Build edges array
    const edges: Array<{
      source: string;
      target: string;
      weight: number;
      normalizedWeight: number;
    }> = [];

    for (const [key, weight] of connections.entries()) {
      const [member1, member2] = key.split("||");

      // Calculate normalized weight (percentage of smaller member's total attendance)
      const member1Total = memberPrickleCounts.get(member1) || 1;
      const member2Total = memberPrickleCounts.get(member2) || 1;
      const minTotal = Math.min(member1Total, member2Total);
      const normalizedWeight = Math.round((weight / minTotal) * 100);

      edges.push({
        source: member1,
        target: member2,
        weight,
        normalizedWeight,
      });
    }

    // Sort edges by weight (strongest connections first)
    edges.sort((a, b) => b.weight - a.weight);

    return NextResponse.json({
      nodes,
      edges,
    });
  } catch (error: any) {
    console.error("Error calculating network:", error);
    return NextResponse.json(
      { error: error.message || "Failed to calculate network" },
      { status: 500 }
    );
  }
}
