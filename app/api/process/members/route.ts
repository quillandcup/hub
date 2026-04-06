import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for processing large batches of members
export const maxDuration = 60; // 60 seconds (max for Hobby tier)

/**
 * Process Bronze layer data (kajabi_members) into Silver layer (members)
 *
 * This endpoint:
 * 1. Reads latest kajabi_members snapshot (Bronze - raw Kajabi CSV)
 * 2. Applies business logic to derive member status from Products/Tags
 * 3. Upserts into members table (Silver - canonical member data)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get the latest snapshot from kajabi_members (most recent imported_at for each email)
    const { data: latestSnapshot, error: snapshotError } = await supabase
      .from("kajabi_members")
      .select("*")
      .order("imported_at", { ascending: false });

    if (snapshotError) throw snapshotError;

    if (!latestSnapshot || latestSnapshot.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No kajabi_members data found. Run /api/import/members first.",
        processed: 0,
      });
    }

    // Get unique emails with their latest snapshot
    const latestByEmail = new Map<string, any>();
    for (const row of latestSnapshot) {
      if (!latestByEmail.has(row.email)) {
        latestByEmail.set(row.email, row);
      }
    }

    const membersToUpsert = [];

    for (const [email, kajabiMember] of latestByEmail) {
      const data = kajabiMember.data;

      // Check if this is subscription data or member data
      const isSubscriptionData = !!data["Customer Name"] && !!data.Status;

      let name: string;
      let createdAt: string;
      let status: "active" | "inactive" | "on_hiatus";
      let plan: string | null = null;

      if (isSubscriptionData) {
        // Subscription export format
        name = data["Customer Name"] || "";
        createdAt = data["Created At"] || "";
        const subscriptionStatus = data.Status || "";

        // Skip if missing critical fields
        if (!name || !createdAt) {
          console.warn(`Skipping member ${email}: missing name or created_at`);
          continue;
        }

        // Map subscription status to member status
        if (subscriptionStatus === "Active" || subscriptionStatus === "Pending Cancellation") {
          status = "active";
        } else if (subscriptionStatus === "Paused") {
          status = "on_hiatus";
        } else if (subscriptionStatus === "Canceled") {
          status = "inactive";
        } else {
          status = "inactive"; // Unknown status defaults to inactive
        }

        // Extract plan from Offer Title
        const offerTitle = data["Offer Title"] || "";
        if (offerTitle.includes("Quill & Cup Membership") || offerTitle.includes("Yes, girl! I see you!")) {
          plan = "Membership";
        } else if (offerTitle) {
          plan = "Other";
        }
      } else {
        // Member export format (legacy)
        name = data.Name || "";
        createdAt = data["Member Created At"] || "";
        const tags = data.Tags || "";
        const products = data.Products || "";

        // Skip if missing critical fields
        if (!name || !createdAt) {
          console.warn(`Skipping member ${email}: missing name or created_at`);
          continue;
        }

        // Derive status from products and tags (business logic)
        // Check Offboarding tag FIRST - it's the strongest signal of cancellation
        if (tags.includes("Offboarding")) {
          status = "inactive"; // Officially cancelled - check this FIRST
        } else if (products.includes("Quill & Cup Membership")) {
          status = "active"; // Has active membership product
        } else if (tags.includes("Quill & Cup Member")) {
          status = "on_hiatus"; // Has member tag but no product = paused
        } else {
          status = "inactive"; // Default: leads, trials, former members
        }

        // Extract plan from products
        if (products.includes("Quill & Cup Membership")) {
          plan = "Membership";
        } else if (products.includes("BFF Program")) {
          plan = "BFF";
        } else if (products) {
          plan = "Other";
        }
      }

      // Format joined_at
      // Kajabi format can be: "2022-09-03 18:49:55 -0600" or "Sep 11, 2022"
      let joinedAt: string;
      if (createdAt.includes(",")) {
        // Format: "Sep 11, 2022" -> "2022-09-11"
        joinedAt = new Date(createdAt).toISOString().split("T")[0];
      } else {
        // Format: "2022-09-03 18:49:55 -0600" -> "2022-09-03"
        joinedAt = createdAt.split(" ")[0];
      }

      membersToUpsert.push({
        email: email.toLowerCase(),
        name,
        joined_at: joinedAt,
        status,
        plan,
      });
    }

    if (membersToUpsert.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No valid members to process",
        processed: 0,
      });
    }

    // Upsert into members table (Silver - canonical data with business logic)
    const { data, error } = await supabase
      .from("members")
      .upsert(membersToUpsert, {
        onConflict: "email",
      })
      .select();

    if (error) {
      console.error("Error upserting members:", error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      processed: data?.length || 0,
      statusBreakdown: {
        active: membersToUpsert.filter((m) => m.status === "active").length,
        on_hiatus: membersToUpsert.filter((m) => m.status === "on_hiatus").length,
        inactive: membersToUpsert.filter((m) => m.status === "inactive").length,
      },
    });
  } catch (error: any) {
    console.error("Error processing members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process members" },
      { status: 500 }
    );
  }
}
