import { createClient } from "@/lib/supabase/server";
import { createKajabiClient } from "@/lib/kajabi/client";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

/**
 * Sync data from Kajabi API
 *
 * This endpoint:
 * 1. Fetches contacts (members) from Kajabi API
 * 2. Fetches subscriptions from Kajabi API
 * 3. Imports to Bronze layer (kajabi_members, subscription_history)
 * 4. Auto-triggers Silver layer processing
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
    const body = await request.json();
    const { importMembers = true, importSubscriptions = true } = body;

    const results: any = {
      members: null,
      subscriptions: null,
    };

    // Create Kajabi API client
    const kajabi = createKajabiClient();

    // Import members if requested
    if (importMembers) {
      console.log("Fetching contacts from Kajabi API...");
      const contacts = await kajabi.fetchAllContacts();
      console.log(`Fetched ${contacts.length} contacts from Kajabi`);

      // Transform to our format (matching CSV import structure)
      // Kajabi API returns JSON:API format with attributes nested
      const importTimestamp = new Date().toISOString();
      const memberRecords = contacts.map((contact) => {
        const attrs = contact.attributes;
        return {
          email: attrs.email.toLowerCase(),
          imported_at: importTimestamp,
          data: {
            Name: attrs.name || "",
            Email: attrs.email,
            "First Name": attrs.name?.split(' ')[0] || "",
            "Last Name": attrs.name?.split(' ').slice(1).join(' ') || "",
            "Member Created At": attrs.created_at,
            "Last Contacted": "", // Not available in JSON:API response
            "Last Activity": "", // Not available in JSON:API response
            Tags: "", // Tags are in relationships, would need separate request
            // Store full raw data
            _raw: contact,
          },
        };
      });

      // Insert into kajabi_members (Bronze)
      const { error: membersError } = await supabase
        .schema("bronze")
        .from("kajabi_members")
        .insert(memberRecords);

      if (membersError) {
        console.error("Error inserting kajabi_members:", membersError);
        throw new Error(`Members import failed: ${membersError.message}`);
      }

      console.log("Triggering member processing...");
      const processingResults = await triggerReprocessing("kajabi_members", "bronze");

      results.members = {
        imported: contacts.length,
        importTimestamp,
        processing: processingResults.processed,
      };
    }

    // Import subscriptions if requested
    if (importSubscriptions) {
      console.log("Fetching subscriptions from Kajabi API...");
      const subscriptions = await kajabi.fetchAllSubscriptions();
      console.log(`Fetched ${subscriptions.length} subscriptions from Kajabi`);

      // Transform to our format (matching CSV import structure)
      // Kajabi API returns JSON:API format with attributes nested
      const importTimestamp = new Date().toISOString();
      const subscriptionRecords = subscriptions.map((sub) => {
        const attrs = sub.attributes;
        return {
          kajabi_subscription_id: sub.id,
          customer_id: attrs.customer_id || "",
          customer_name: attrs.customer_name || "",
          customer_email: (attrs.customer_email || "").toLowerCase(),
          status: attrs.status,
          amount: attrs.amount || "",
          currency: attrs.currency || "",
          interval: attrs.interval || "",
          created_at_kajabi: attrs.created_at,
          canceled_on: attrs.canceled_on || null,
          trial_ends_on: attrs.trial_ends_on || null,
          next_payment_date: attrs.next_payment_date || null,
          offer_id: attrs.offer_id || "",
          offer_title: attrs.offer_title || "",
          provider: attrs.provider || "",
          provider_id: attrs.provider_id || "",
          imported_at: importTimestamp,
          data: sub, // Store full raw data
        };
      });

      // UPSERT to make imports idempotent
      const { error: subsError, data: inserted } = await supabase
        .schema("bronze")
        .from("subscription_history")
        .upsert(subscriptionRecords, {
          onConflict: "kajabi_subscription_id,imported_at",
        })
        .select();

      if (subsError) {
        console.error("Error inserting subscription_history:", subsError);
        throw new Error(`Subscriptions import failed: ${subsError.message}`);
      }

      // Count status breakdown
      const statusBreakdown = subscriptions.reduce((acc: any, sub) => {
        const status = sub.attributes.status;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      console.log("Triggering hiatus processing...");
      const processingResults = await triggerReprocessing("subscription_history", "bronze");

      results.subscriptions = {
        imported: inserted?.length || 0,
        importTimestamp,
        statusBreakdown,
        processing: processingResults.processed,
      };
    }

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (error: any) {
    console.error("Error syncing Kajabi data:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to sync Kajabi data",
        details: error.stack,
      },
      { status: 500 }
    );
  }
}
