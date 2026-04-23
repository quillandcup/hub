import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Import subscription data from Kajabi CSV exports into subscription_history (Bronze layer)
 *
 * This endpoint:
 * 1. Accepts Kajabi subscription CSV uploads
 * 2. Stores ALL subscriptions (not just one per email) with import timestamp
 * 3. Allows multiple imports over time to build subscription history
 * 4. Uses UPSERT on (kajabi_subscription_id, imported_at) to make imports idempotent
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
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".csv")) {
      return NextResponse.json(
        { error: "File must be a CSV" },
        { status: 400 }
      );
    }

    const text = await file.text();
    const subscriptions = parseSubscriptionCSV(text);

    if (subscriptions.length === 0) {
      return NextResponse.json(
        { error: "No valid subscriptions found in CSV" },
        { status: 400 }
      );
    }

    // Insert into subscription_history (Bronze - raw data)
    const importTimestamp = new Date().toISOString();
    const records = subscriptions.map((sub) => ({
      kajabi_subscription_id: sub.kajabi_subscription_id,
      customer_id: sub.customer_id,
      customer_name: sub.customer_name,
      customer_email: sub.customer_email.toLowerCase(),
      status: sub.status,
      amount: sub.amount,
      currency: sub.currency,
      interval: sub.interval,
      created_at_kajabi: sub.created_at_kajabi,
      canceled_on: sub.canceled_on,
      trial_ends_on: sub.trial_ends_on,
      next_payment_date: sub.next_payment_date,
      offer_id: sub.offer_id,
      offer_title: sub.offer_title,
      provider: sub.provider,
      provider_id: sub.provider_id,
      imported_at: importTimestamp,
      data: sub.raw_data,
    }));

    // UPSERT to make imports idempotent
    const { error: insertError, data: inserted } = await supabase
      .schema('bronze').from("subscription_history")
      .upsert(records, {
        onConflict: "kajabi_subscription_id,imported_at",
      })
      .select();

    if (insertError) {
      console.error("Error inserting subscriptions:", insertError);
      throw insertError;
    }

    // Count status breakdown
    const statusBreakdown = subscriptions.reduce((acc: any, sub) => {
      acc[sub.status] = (acc[sub.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      imported: inserted?.length || 0,
      importTimestamp,
      statusBreakdown,
      message: "Imported to subscription_history. Run /api/process/hiatus to detect hiatus periods.",
    });
  } catch (error: any) {
    console.error("Error importing subscriptions:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import subscriptions" },
      { status: 500 }
    );
  }
}

function parseSubscriptionCSV(text: string): any[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  // Validate this is a Kajabi Subscriptions export
  const requiredColumns = [
    "Kajabi Subscription ID",
    "Customer Email",
    "Customer Name",
    "Status",
    "Created At",
  ];

  for (const col of requiredColumns) {
    if (!headers.includes(col)) {
      throw new Error(`Missing required column: ${col}. This does not appear to be a Kajabi Subscriptions export.`);
    }
  }

  // Map column indices
  const idxMap: any = {};
  headers.forEach((header, idx) => {
    idxMap[header] = idx;
  });

  const subscriptions: any[] = [];

  for (let i = 0; i < lines.slice(1).length; i++) {
    const line = lines[i + 1].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const subscriptionId = values[idxMap["Kajabi Subscription ID"]]?.trim();
    const email = values[idxMap["Customer Email"]]?.trim();
    const name = values[idxMap["Customer Name"]]?.trim();
    const status = values[idxMap["Status"]]?.trim();
    const createdAt = values[idxMap["Created At"]]?.trim();

    // Skip if missing required fields
    if (!subscriptionId || !email || !name || !status || !createdAt) {
      console.warn(`Skipping row ${i + 2}: missing required fields`);
      continue;
    }

    // Validate email
    if (!email.includes("@")) {
      console.warn(`Skipping row ${i + 2}: invalid email "${email}"`);
      continue;
    }

    // Store raw data as JSONB
    const rawData: any = {};
    headers.forEach((header, idx) => {
      rawData[header] = values[idx]?.trim() || "";
    });

    subscriptions.push({
      kajabi_subscription_id: subscriptionId,
      customer_id: values[idxMap["Customer ID"]]?.trim() || null,
      customer_name: name,
      customer_email: email,
      status: status,
      amount: values[idxMap["Amount"]]?.trim() || null,
      currency: values[idxMap["Currency"]]?.trim() || null,
      interval: values[idxMap["Interval"]]?.trim() || null,
      created_at_kajabi: createdAt,
      canceled_on: values[idxMap["Canceled On"]]?.trim() || null,
      trial_ends_on: values[idxMap["Trial Ends On"]]?.trim() || null,
      next_payment_date: values[idxMap["Next Payment Date"]]?.trim() || null,
      offer_id: values[idxMap["Offer ID"]]?.trim() || null,
      offer_title: values[idxMap["Offer Title"]]?.trim() || null,
      provider: values[idxMap["Provider"]]?.trim() || null,
      provider_id: values[idxMap["Provider ID"]]?.trim() || null,
      raw_data: rawData,
    });
  }

  return subscriptions;
}

// Parse a CSV line handling quoted fields with commas
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
