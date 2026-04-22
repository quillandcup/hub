import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // Check authentication
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests/scripts
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
    const formData = await request.formData();
    const usersFile = formData.get("users") as File;
    const channelsFile = formData.get("channels") as File;
    const messagesFile = formData.get("messages") as File;
    const reactionsFile = formData.get("reactions") as File;

    if (!usersFile || !channelsFile || !messagesFile || !reactionsFile) {
      return NextResponse.json(
        { error: "All 4 CSV files required: users, channels, messages, reactions" },
        { status: 400 }
      );
    }

    // Parse CSVs
    const users = await parseCSV(usersFile);
    const channels = await parseCSV(channelsFile);
    const messages = await parseCSV(messagesFile);
    const reactions = await parseCSV(reactionsFile);

    console.log(`Importing: ${users.length} users, ${channels.length} channels, ${messages.length} messages, ${reactions.length} reactions`);

    // UPSERT to Bronze tables (idempotent)
    const importTimestamp = new Date().toISOString();

    const { error: usersError } = await supabase
      .from("bronze.slack_users")
      .upsert(
        users.map(u => ({ ...u, imported_at: importTimestamp })),
        { onConflict: "user_id" }
      );

    const { error: channelsError } = await supabase
      .from("bronze.slack_channels")
      .upsert(
        channels.map(c => ({ ...c, imported_at: importTimestamp })),
        { onConflict: "channel_id" }
      );

    const { error: messagesError } = await supabase
      .from("bronze.slack_messages")
      .upsert(
        messages.map(m => ({ ...m, imported_at: importTimestamp })),
        { onConflict: "channel_id,message_ts" }
      );

    const { error: reactionsError } = await supabase
      .from("bronze.slack_reactions")
      .upsert(
        reactions.map(r => ({ ...r, imported_at: importTimestamp })),
        { onConflict: "channel_id,message_ts,reaction,user_id" }
      );

    if (usersError) throw usersError;
    if (channelsError) throw channelsError;
    if (messagesError) throw messagesError;
    if (reactionsError) throw reactionsError;

    // Detect date range from imported messages
    let dateRange = null;
    if (messages.length > 0) {
      const dates = messages
        .map(m => m.occurred_at)
        .filter(d => d)
        .sort();

      if (dates.length > 0) {
        dateRange = {
          fromDate: dates[0].split('T')[0], // First message date (YYYY-MM-DD)
          toDate: dates[dates.length - 1].split('T')[0], // Last message date (YYYY-MM-DD)
        };
      }
    }

    return NextResponse.json({
      success: true,
      imported: {
        users: users.length,
        channels: channels.length,
        messages: messages.length,
        reactions: reactions.length,
      },
      importTimestamp,
      dateRange,
      message: "Imported to Slack Bronze tables. Run /api/process/slack to populate member_activities.",
    });
  } catch (error: any) {
    console.error("Error importing Slack data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import Slack data" },
      { status: 500 }
    );
  }
}

async function parseCSV(file: File): Promise<any[]> {
  const text = await file.text();
  const rows = parseCSVText(text);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];
  const data: any[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const row: any = {};

    headers.forEach((header, index) => {
      const value = values[index]?.trim() || "";
      // Parse JSON fields
      if (header === 'raw_payload') {
        // raw_payload is NOT NULL in database, default to empty object
        try {
          row[header] = value ? JSON.parse(value) : {};
        } catch {
          row[header] = {};
        }
      } else if (header === 'files') {
        // files can be null
        try {
          row[header] = value ? JSON.parse(value) : null;
        } catch {
          row[header] = null;
        }
      } else if (header === 'is_bot' || header === 'is_deleted' || header === 'is_private' || header === 'is_archived') {
        row[header] = value === 'true';
      } else if (header === 'reply_count' || header === 'reply_users_count' || header === 'member_count') {
        row[header] = value ? parseInt(value, 10) : 0;
      } else {
        row[header] = value || null;
      }
    });

    data.push(row);
  }

  return data;
}

// Parse CSV text handling quoted fields with commas, newlines, and escaped quotes
function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = i + 1 < text.length ? text[i + 1] : null;

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("") - add single quote to field
        currentField += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // Row separator (handle both \n and \r\n)
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \n in \r\n
      }
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      }
    } else {
      // Regular character
      currentField += char;
    }
  }

  // Push last field and row if not empty
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}
