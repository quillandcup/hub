import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // 60 seconds for processing

/**
 * Process subscription history to detect hiatus periods (Bronze → Silver)
 *
 * Strategy:
 * 1. Load all subscription_history snapshots ordered by imported_at
 * 2. For each member (email), track status changes over time
 * 3. Detect transitions:
 *    - Active/Pending Cancellation → Paused = hiatus start
 *    - Paused → Active = hiatus end
 *    - Paused → Canceled = hiatus ended (member left)
 * 4. Create member_hiatus_history records for each hiatus period
 * 5. Update members table with current hiatus status
 *
 * Note: This uses DELETE + INSERT pattern for reprocessability
 */
export async function POST(request: NextRequest) {
  // Check authentication (supports both cookie-based and service role key)
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  } else {
    // Use cookie-based client for normal requests
    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // STEP 1: Load all subscription history ordered by import time
    const { data: subscriptionHistory, error: loadError } = await supabase
      .schema('bronze').from("subscription_history")
      .select("*")
      .order("imported_at", { ascending: true })
      .order("customer_email", { ascending: true });

    if (loadError) throw loadError;

    if (!subscriptionHistory || subscriptionHistory.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No subscription history found. Import subscriptions first.",
        processed: 0,
      });
    }

    console.log(`[DEBUG] Processing ${subscriptionHistory.length} subscription history records`);

    // STEP 2: Group by email and detect status changes
    const hiatusPeriods: any[] = [];
    const membersByEmail = new Map<string, any[]>();

    // Group subscription snapshots by email
    for (const record of subscriptionHistory) {
      const email = record.customer_email.toLowerCase();
      if (!membersByEmail.has(email)) {
        membersByEmail.set(email, []);
      }
      membersByEmail.get(email)!.push(record);
    }

    // Analyze each member's subscription timeline
    for (const [email, snapshots] of membersByEmail) {
      // Sort by import time (should already be sorted, but ensure it)
      snapshots.sort((a, b) =>
        new Date(a.imported_at).getTime() - new Date(b.imported_at).getTime()
      );

      let previousStatus: string | null = null;
      let hiatusStartDate: Date | null = null;

      for (let i = 0; i < snapshots.length; i++) {
        const currentSnapshot = snapshots[i];
        const currentStatus = currentSnapshot.status;
        const snapshotDate = new Date(currentSnapshot.imported_at);

        // Detect status transition
        if (previousStatus !== null && previousStatus !== currentStatus) {
          // Started hiatus: Active/Pending → Paused
          if (
            (previousStatus === "Active" || previousStatus === "Pending Cancellation") &&
            currentStatus === "Paused"
          ) {
            hiatusStartDate = snapshotDate;
            console.log(`[DEBUG] ${email}: Hiatus started around ${snapshotDate.toISOString()}`);
          }

          // Ended hiatus: Paused → Active or Paused → Canceled
          if (
            previousStatus === "Paused" &&
            (currentStatus === "Active" || currentStatus === "Canceled")
          ) {
            if (hiatusStartDate) {
              hiatusPeriods.push({
                email,
                customer_name: currentSnapshot.customer_name,
                start_date: hiatusStartDate.toISOString().split("T")[0],
                end_date: snapshotDate.toISOString().split("T")[0],
                reason: currentStatus === "Canceled" ? "Canceled during hiatus" : "Resumed",
              });
              console.log(`[DEBUG] ${email}: Hiatus ended around ${snapshotDate.toISOString()}`);
              hiatusStartDate = null;
            }
          }
        }

        previousStatus = currentStatus;
      }

      // If still on hiatus (last status was Paused), create open-ended hiatus
      if (previousStatus === "Paused" && hiatusStartDate) {
        const lastSnapshot = snapshots[snapshots.length - 1];
        hiatusPeriods.push({
          email,
          customer_name: lastSnapshot.customer_name,
          start_date: hiatusStartDate.toISOString().split("T")[0],
          end_date: null, // Still ongoing
          reason: "Currently on hiatus",
        });
        console.log(`[DEBUG] ${email}: Still on hiatus (started ${hiatusStartDate.toISOString()})`);
      }
    }

    console.log(`[DEBUG] Detected ${hiatusPeriods.length} hiatus periods`);

    // STEP 3: Map emails to member IDs
    const emails = [...new Set(hiatusPeriods.map(h => h.email))];
    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("id, email")
      .in("email", emails);

    if (membersError) throw membersError;

    const emailToMemberId = new Map(
      (members || []).map(m => [m.email, m.id])
    );

    // Filter out hiatuses for members not in the system
    const hiatusRecords = hiatusPeriods
      .map(h => ({
        member_id: emailToMemberId.get(h.email),
        start_date: h.start_date,
        end_date: h.end_date,
        reason: h.reason,
        notes: null,
      }))
      .filter(h => h.member_id !== undefined);

    console.log(`[DEBUG] Matched ${hiatusRecords.length} hiatus periods to members`);

    // STEP 4: DELETE existing hiatus history (for reprocessability)
    const { error: deleteError } = await supabase
      .from("member_hiatus_history")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.error("Error deleting existing hiatus history:", deleteError);
      throw deleteError;
    }

    // STEP 5: INSERT fresh hiatus records
    if (hiatusRecords.length > 0) {
      const { error: insertError } = await supabase
        .from("member_hiatus_history")
        .insert(hiatusRecords);

      if (insertError) {
        console.error("Error inserting hiatus history:", insertError);
        throw insertError;
      }
    }

    return NextResponse.json({
      success: true,
      processed: hiatusRecords.length,
      detectedPeriods: hiatusPeriods.length,
      matchedToMembers: hiatusRecords.length,
      statusBreakdown: {
        ongoing: hiatusRecords.filter(h => h.end_date === null).length,
        completed: hiatusRecords.filter(h => h.end_date !== null).length,
      },
    });
  } catch (error: any) {
    console.error("Error processing hiatus:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process hiatus" },
      { status: 500 }
    );
  }
}
