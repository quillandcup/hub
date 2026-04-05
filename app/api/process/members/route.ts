import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

      const name = data.Name || "";
      const createdAt = data["Member Created At"] || "";
      const tags = data.Tags || "";
      const products = data.Products || "";

      // Skip if missing critical fields
      if (!name || !createdAt) {
        console.warn(`Skipping member ${email}: missing name or created_at`);
        continue;
      }

      // Derive status from products and tags (business logic)
      // Check Offboarding tag FIRST - it's the strongest signal of cancellation
      // Active = has membership product AND no offboarding tag
      // On Hiatus = has member tag but product removed during pause
      // Inactive = offboarding tag OR neither product nor tag (leads/trials)
      let status: "active" | "inactive" | "on_hiatus";
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
      let plan: string | null = null;
      if (products.includes("Quill & Cup Membership")) {
        plan = "Membership";
      } else if (products.includes("BFF Program")) {
        plan = "BFF";
      } else if (products) {
        plan = "Other";
      }

      // Format joined_at (Kajabi format: "2022-09-03 18:49:55 -0600")
      // Convert to ISO date: "2022-09-03"
      const joinedAt = createdAt.split(" ")[0];

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
