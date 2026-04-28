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
      const importTimestamp = new Date().toISOString();
      const memberRecords = contacts.map((contact) => ({
        email: contact.email.toLowerCase(),
        imported_at: importTimestamp,
        data: {
          Name: contact.name || `${contact.first_name} ${contact.last_name}`.trim(),
          Email: contact.email,
          "First Name": contact.first_name || "",
          "Last Name": contact.last_name || "",
          "Member Created At": contact.created_at,
          "Last Contacted": contact.last_contacted || "",
          "Last Activity": contact.last_activity || "",
          Tags: Array.isArray(contact.tags) ? contact.tags.join(", ") : "",
          // Store full raw data
          _raw: contact,
        },
      }));

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
      const importTimestamp = new Date().toISOString();
      const subscriptionRecords = subscriptions.map((sub) => ({
        kajabi_subscription_id: sub.id,
        customer_id: sub.customer_id,
        customer_name: sub.customer_name,
        customer_email: sub.customer_email.toLowerCase(),
        status: sub.status,
        amount: sub.amount,
        currency: sub.currency,
        interval: sub.interval,
        created_at_kajabi: sub.created_at,
        canceled_on: sub.canceled_on,
        trial_ends_on: sub.trial_ends_on,
        next_payment_date: sub.next_payment_date,
        offer_id: sub.offer_id,
        offer_title: sub.offer_title,
        provider: sub.provider,
        provider_id: sub.provider_id,
        imported_at: importTimestamp,
        data: sub, // Store full raw data
      }));

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
        acc[sub.status] = (acc[sub.status] || 0) + 1;
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
