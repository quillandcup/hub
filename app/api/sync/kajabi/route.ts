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
    const results: any = {
      members: null,
    };

    // Create Kajabi API client
    const kajabi = createKajabiClient();

    // Import members (contacts, customers, purchases, offers)
    // Following medallion architecture: Store RAW data in Bronze, transform in Silver
      console.log("Fetching raw data from Kajabi API (contacts, customers, purchases, offers)...");

      // Fetch all raw data from Kajabi API
      const [contacts, customers, purchases, offers] = await Promise.all([
        kajabi.fetchAllContacts(),
        kajabi.fetchAllCustomers(),
        kajabi.fetchAllSubscriptions(),
        kajabi.fetchAllOffers(),
      ]);

      console.log(`Fetched ${contacts.length} contacts, ${customers.length} customers, ${purchases.length} purchases, ${offers.length} offers from Kajabi`);

      const importTimestamp = new Date().toISOString();

      // BRONZE LAYER: Store raw data as-is (no transformation)

      // 1. Contacts (all people in Kajabi)
      const contactRecords = contacts.map(contact => ({
        kajabi_contact_id: contact.id,
        email: contact.attributes.email.toLowerCase(),
        name: contact.attributes.name,
        created_at_kajabi: contact.attributes.created_at,
        updated_at_kajabi: contact.attributes.updated_at,
        imported_at: importTimestamp,
        data: contact,
      }));

      const { error: contactsError } = await supabase
        .schema("bronze")
        .from("kajabi_contacts")
        .upsert(contactRecords, { onConflict: "kajabi_contact_id" });

      if (contactsError) {
        console.error("Error upserting kajabi_contacts:", contactsError);
        throw new Error(`Contacts import failed: ${contactsError.message}`);
      }

      // 2. Customers (people who made purchases)
      const customerRecords = customers.map(customer => ({
        kajabi_customer_id: customer.id,
        email: customer.attributes.email.toLowerCase(),
        name: customer.attributes.name,
        created_at_kajabi: customer.attributes.created_at,
        updated_at_kajabi: customer.attributes.updated_at,
        imported_at: importTimestamp,
        data: customer,
      }));

      const { error: customersError } = await supabase
        .schema("bronze")
        .from("kajabi_customers")
        .upsert(customerRecords, { onConflict: "kajabi_customer_id" });

      if (customersError) {
        console.error("Error upserting kajabi_customers:", customersError);
        throw new Error(`Customers import failed: ${customersError.message}`);
      }

      // 3. Purchases (subscription records)
      const purchaseRecords = purchases.map(purchase => ({
        kajabi_purchase_id: purchase.id,
        kajabi_customer_id: purchase.relationships?.customer?.data?.id || null,
        kajabi_offer_id: purchase.relationships?.offer?.data?.id || null,
        amount_in_cents: purchase.attributes.amount_in_cents,
        currency: purchase.attributes.currency || 'USD',
        status: purchase.attributes.deactivated_at ? 'canceled' : 'active',
        created_at_kajabi: purchase.attributes.created_at,
        effective_start_at: purchase.attributes.effective_start_at,
        deactivated_at: purchase.attributes.deactivated_at,
        imported_at: importTimestamp,
        data: purchase,
      }));

      const { error: purchasesError } = await supabase
        .schema("bronze")
        .from("kajabi_purchases")
        .upsert(purchaseRecords, { onConflict: "kajabi_purchase_id" });

      if (purchasesError) {
        console.error("Error upserting kajabi_purchases:", purchasesError);
        throw new Error(`Purchases import failed: ${purchasesError.message}`);
      }

      // 4. Offers (products/subscriptions offered)
      const offerRecords = offers.map(offer => ({
        kajabi_offer_id: offer.id,
        name: offer.attributes.title, // title, not name
        status: offer.attributes.status,
        trial_period_days: offer.attributes.trial_period_days,
        imported_at: importTimestamp,
        data: offer,
      }));

      const { error: offersError } = await supabase
        .schema("bronze")
        .from("kajabi_offers")
        .upsert(offerRecords, { onConflict: "kajabi_offer_id" });

      if (offersError) {
        console.error("Error upserting kajabi_offers:", offersError);
        throw new Error(`Offers import failed: ${offersError.message}`);
      }

      console.log("Bronze import complete. Triggering Silver processing...");
      const processingResults = await triggerReprocessing("kajabi_contacts", "bronze");

      results.members = {
        contacts: contactRecords.length,
        customers: customerRecords.length,
        purchases: purchaseRecords.length,
        offers: offerRecords.length,
        importTimestamp,
        processing: processingResults.processed,
      };

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
