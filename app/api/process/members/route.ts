import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for processing large batches of members
export const maxDuration = 60; // 60 seconds (max for Hobby tier)

/**
 * Process Bronze layer data into Silver layer (members)
 *
 * Bronze sources:
 * 1. kajabi_members - Paying customers from Kajabi
 * 2. staff - Team members (owners, staff, contractors)
 *
 * This endpoint:
 * 1. Reads latest kajabi_members snapshot
 * 2. Reads staff table
 * 3. Applies business logic to both sources
 * 4. Regenerates members table (DELETE + INSERT pattern)
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
    // STEP 1: Load Bronze data from both sources
    const [
      { data: kajabiSnapshot, error: kajabiError },
      { data: staffMembers, error: staffError }
    ] = await Promise.all([
      supabase
        .from("kajabi_members")
        .select("*")
        .order("imported_at", { ascending: false }),
      supabase
        .from("staff")
        .select("*")
    ]);

    if (kajabiError) throw kajabiError;
    if (staffError) throw staffError;

    console.log('[DEBUG] Bronze sources:', {
      kajabi_count: kajabiSnapshot?.length || 0,
      staff_count: staffMembers?.length || 0,
    });

    // STEP 2: Process Kajabi members (Bronze source 1)
    const kajabiMembers = [];

    if (kajabiSnapshot && kajabiSnapshot.length > 0) {
      // Get unique emails with their latest snapshot
      const latestByEmail = new Map<string, any>();
      for (const row of kajabiSnapshot) {
        if (!latestByEmail.has(row.email)) {
          latestByEmail.set(row.email, row);
        }
      }

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

        kajabiMembers.push({
          email: email.toLowerCase(),
          name,
          joined_at: joinedAt,
          status,
          plan,
          source: 'kajabi',
          staff_role: null,
          user_id: null,
        });
      }
    }

    // STEP 3: Process staff members (Bronze source 2)
    const processedStaffMembers = (staffMembers || []).map(staff => ({
      email: staff.email.toLowerCase(),
      name: staff.name,
      joined_at: staff.hire_date || '2020-01-01', // Default for staff without hire_date
      status: 'active' as const, // Staff are always active
      plan: null, // Staff don't have plans
      source: 'staff',
      staff_role: staff.role,
      user_id: staff.user_id,
    }));

    // STEP 4: Combine both sources
    const allMembers = [...kajabiMembers, ...processedStaffMembers];

    if (allMembers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No valid members to process from either source",
        processed: 0,
      });
    }

    // STEP 5: DELETE all existing members (for reprocessability)
    // This makes the process fully reprocessable - we regenerate Silver from Bronze
    console.log("Deleting all existing members");
    const { error: deleteError } = await supabase
      .from("members")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all (PostgreSQL DELETE requires a WHERE clause)

    if (deleteError) {
      console.error("Error deleting existing members:", deleteError);
      throw deleteError;
    }

    // STEP 6: INSERT fresh members from both Bronze sources
    const { data, error } = await supabase
      .from("members")
      .insert(allMembers)
      .select();

    if (error) {
      console.error("Error inserting members:", error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      processed: data?.length || 0,
      sourceBreakdown: {
        kajabi: kajabiMembers.length,
        staff: processedStaffMembers.length,
      },
      statusBreakdown: {
        active: allMembers.filter((m) => m.status === "active").length,
        on_hiatus: allMembers.filter((m) => m.status === "on_hiatus").length,
        inactive: allMembers.filter((m) => m.status === "inactive").length,
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
