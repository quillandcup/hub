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
      console.log("Fetching purchases (subscriptions) from Kajabi API...");
      const purchases = await kajabi.fetchAllSubscriptions();
      console.log(`Fetched ${purchases.length} purchases from Kajabi`);

      // Fetch customers to get email/name (required for hiatus processing)
      console.log("Fetching customers to enrich purchase data...");
      const customers = await kajabi.fetchAllCustomers();
      console.log(`Fetched ${customers.length} customers from Kajabi`);

      // Build customer lookup map
      const customerMap = new Map<string, any>();
      for (const customer of customers) {
        customerMap.set(customer.id, customer.attributes);
      }

      console.log(`Customer map size: ${customerMap.size}`);
      console.log(`Sample customer IDs: ${Array.from(customerMap.keys()).slice(0, 5).join(', ')}`);

      // Log sample purchase structure to debug
      if (purchases.length > 0) {
        const sample = purchases[0];
        console.log(`Sample purchase relationships:`, JSON.stringify(sample.relationships, null, 2));
      }

      // Transform to our format (matching CSV import structure)
      // Kajabi API returns purchases (not subscriptions) with JSON:API format
      const importTimestamp = new Date().toISOString();
      let skippedCount = 0;
      const subscriptionRecords = purchases
        .map((purchase) => {
          const attrs = purchase.attributes;
          const customerId = purchase.relationships?.customer?.data?.id || "";
          const offerId = purchase.relationships?.offer?.data?.id || "";

          // Get customer data from lookup
          const customer = customerMap.get(customerId);

          // Skip if no customer data (required for hiatus processing)
          if (!customer || !customer.email) {
            if (skippedCount < 5) {
              console.warn(`Skipping purchase ${purchase.id}: no customer data found for customer_id "${customerId}"`);
            }
            skippedCount++;
            return null;
          }

          // Determine status from deactivated_at field
          const status = attrs.deactivated_at ? "Canceled" : "Active";

          return {
            kajabi_subscription_id: purchase.id,
            customer_id: customerId,
            customer_name: customer.name || "",
            customer_email: customer.email.toLowerCase(),
            status: status,
            amount: attrs.amount_in_cents ? (attrs.amount_in_cents / 100).toString() : "",
            currency: "USD", // Assuming USD, not in API response
            interval: "", // Not available in purchases endpoint
            created_at_kajabi: attrs.effective_start_at || attrs.created_at,
            canceled_on: attrs.deactivated_at || null,
            trial_ends_on: null, // Not available in purchases endpoint
            next_payment_date: null, // Not available in purchases endpoint
            offer_id: offerId,
            offer_title: "", // Would require separate offers API call
            provider: "Kajabi", // Purchases are through Kajabi
            provider_id: purchase.id,
            imported_at: importTimestamp,
            data: purchase, // Store full raw data
          };
        })
        .filter((record): record is NonNullable<typeof record> => record !== null);

      if (skippedCount > 0) {
        console.warn(`Skipped ${skippedCount} purchases due to missing customer data`);
      }
      console.log(`Successfully mapped ${subscriptionRecords.length} purchases to subscription records`);

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
      const statusBreakdown = purchases.reduce((acc: any, purchase) => {
        const status = purchase.attributes.deactivated_at ? "Canceled" : "Active";
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
