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
    // STEP 1: Load Bronze data from both sources + email aliases
    const [
      { data: kajabiSnapshot, error: kajabiError },
      { data: staffMembers, error: staffError },
      { data: emailAliases, error: aliasesError }
    ] = await Promise.all([
      supabase
        .schema('bronze').from("kajabi_members")
        .select("*")
        .order("imported_at", { ascending: false }),
      supabase
        .from("staff")
        .select("*"),
      supabase
        .from("member_email_aliases")
        .select("*")
    ]);

    if (kajabiError) throw kajabiError;
    if (staffError) throw staffError;
    if (aliasesError) throw aliasesError;

    console.log('[DEBUG] Bronze sources:', {
      kajabi_count: kajabiSnapshot?.length || 0,
      staff_count: staffMembers?.length || 0,
      email_aliases_count: emailAliases?.length || 0,
    });

    // Build alias map: alias_email -> canonical_email
    const aliasMap = new Map<string, string>();
    if (emailAliases && emailAliases.length > 0) {
      for (const alias of emailAliases) {
        aliasMap.set(alias.alias_email.toLowerCase(), alias.canonical_email.toLowerCase());
      }
    }

    // Helper function to resolve email via aliases
    function resolveEmail(email: string): string {
      const normalized = email.toLowerCase();
      return aliasMap.get(normalized) || normalized;
    }

    // STEP 2: Process Kajabi members (Bronze source 1)
    const kajabiMembers = [];

    if (kajabiSnapshot && kajabiSnapshot.length > 0) {
      // Group all snapshots by canonical email (resolve aliases first)
      const snapshotsByEmail = new Map<string, any[]>();
      for (const row of kajabiSnapshot) {
        const canonicalEmail = resolveEmail(row.email);
        if (!snapshotsByEmail.has(canonicalEmail)) {
          snapshotsByEmail.set(canonicalEmail, []);
        }
        snapshotsByEmail.get(canonicalEmail)!.push(row);
      }

      // Process each canonical email: use latest snapshot for core data, merge external IDs from all snapshots
      for (const [email, snapshots] of snapshotsByEmail) {
      // Use the most recent snapshot for core member data
      const latestSnapshot = snapshots[0]; // Already sorted by imported_at DESC
      const data = latestSnapshot.data;

      // Collect external IDs from ALL snapshots (prefer first non-null value found)
      let kajabiId = null;
      let stripeCustomerId = null;
      for (const snapshot of snapshots) {
        const snapshotData = snapshot.data;
        if (!kajabiId && snapshotData.ID) {
          kajabiId = snapshotData.ID;
        }
        if (!stripeCustomerId && snapshotData.Provider === "Stripe" && snapshotData["Provider ID"]) {
          stripeCustomerId = snapshotData["Provider ID"];
        }
      }

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

      // External IDs were collected from all snapshots above (before the main processing loop)

        kajabiMembers.push({
          email: email.toLowerCase(),
          name,
          joined_at: joinedAt,
          status,
          plan,
          source: 'kajabi',
          staff_role: null,
          user_id: null,
          kajabi_id: kajabiId, // Merged from all snapshots
          stripe_customer_id: stripeCustomerId, // Merged from all snapshots
        });
      }
    }

    // STEP 3: Process staff members (Bronze source 2)
    const processedStaffMembers = (staffMembers || []).map(staff => ({
      email: resolveEmail(staff.email), // Resolve to canonical email
      name: staff.name,
      joined_at: staff.hire_date || '2020-01-01', // Default for staff without hire_date
      status: 'active' as const, // Staff are always active
      plan: null, // Staff don't have plans
      source: 'staff',
      staff_role: staff.role,
      user_id: staff.user_id,
      kajabi_id: null, // Staff don't have Kajabi IDs
      stripe_customer_id: null, // Staff don't have Stripe IDs
    }));

    // STEP 4: Combine both sources (deduplicate by email, prefer staff over kajabi)
    const membersByEmail = new Map<string, any>();

    // Add Kajabi members first
    for (const member of kajabiMembers) {
      membersByEmail.set(member.email, member);
    }

    // Add staff members (overwrites Kajabi if duplicate - staff is authoritative)
    for (const member of processedStaffMembers) {
      membersByEmail.set(member.email, member);
    }

    const allMembers = Array.from(membersByEmail.values());

    if (allMembers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No valid members to process from either source",
        processed: 0,
      });
    }

    console.log(`Combined sources: ${kajabiMembers.length} Kajabi + ${processedStaffMembers.length} staff = ${allMembers.length} unique members`);

    // STEP 5: Atomically reprocess members using database function
    // This ensures DELETE + INSERT happens in a single transaction,
    // preventing users from seeing partial state during reprocessing
    console.log("Atomically reprocessing all members");

    const { error: reprocessError } = await supabase.rpc('reprocess_members_atomic', {
      new_data: allMembers,
    });

    if (reprocessError) {
      console.error("Error atomically reprocessing members:", reprocessError);
      throw reprocessError;
    }

    return NextResponse.json({
      success: true,
      processed: allMembers.length,
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
