/**
 * Auto-processing trigger for Bronze layer changes
 *
 * When Bronze data changes (via sync/import), automatically triggers
 * downstream Silver layer reprocessing to maintain data consistency.
 */

// Silver table dependencies configuration
export interface TableDependencies {
  bronze: string[];  // Bronze tables this depends on
  local: string[];   // Local tables this depends on
  silver: string[];  // Other Silver tables this depends on
  processingScope: 'full' | 'date-range';  // How to scope reprocessing
  dateField?: string;  // Required if processingScope = 'date-range'
  localDefaultFutureDays?: number;  // Days forward to include when local deps change (default: 0)
}

export const SILVER_DEPENDENCIES: Record<string, TableDependencies> = {
  members: {
    bronze: ['kajabi_contacts', 'kajabi_customers', 'kajabi_purchases', 'kajabi_offers'],
    local: ['member_email_aliases'],
    silver: [],
    processingScope: 'full'  // Entity state, no date scoping
  },

  calendar: {
    bronze: ['calendar_events'],
    local: ['prickle_types', 'member_name_aliases'],
    silver: [],
    processingScope: 'date-range',
    dateField: 'start_time',
    // Calendar events are pre-scheduled months in advance, so local changes
    // (like new host aliases) must reprocess future prickles too
    localDefaultFutureDays: 90,
  },

  attendance: {
    bronze: ['zoom_attendees'],
    local: ['member_name_aliases', 'ignored_zoom_names'],
    silver: ['members', 'calendar'],  // Must process members and calendar prickles first
    processingScope: 'date-range',
    dateField: 'join_time'
  },

  slack: {
    bronze: ['slack_messages', 'slack_reactions'],
    local: ['ignored_slack_users'],
    silver: ['members'],  // Must process members first for matching
    processingScope: 'date-range',
    dateField: 'occurred_at'
  }
};

/**
 * Find which Silver tables are affected by a Bronze/Local table change
 *
 * IMPORTANT: Silver dependencies are processing order constraints, NOT change propagation.
 * Only Bronze/Local dependencies trigger reprocessing.
 *
 * EXCEPTION: calendar_events changes also trigger attendance reprocessing because
 * calendar prickles get new UUIDs during reprocessing, orphaning attendance records.
 */
export function getAffectedSilverTables(
  changedTable: string,
  layer: 'bronze' | 'local'
): string[] {
  const affected: string[] = [];

  for (const [silverTable, deps] of Object.entries(SILVER_DEPENDENCIES)) {
    if (deps[layer].includes(changedTable)) {
      affected.push(silverTable);
    }
  }

  // SPECIAL CASE: calendar_events changes orphan attendance records
  // because calendar reprocessing creates new prickle UUIDs.
  // Must reprocess attendance to re-link to new prickles.
  if (layer === 'bronze' && changedTable === 'calendar_events') {
    if (!affected.includes('attendance')) {
      affected.push('attendance');
    }
  }

  return affected;
}

function getDownstreamSilverTables(silverTable: string): string[] {
  const downstream: string[] = [];

  for (const [table, deps] of Object.entries(SILVER_DEPENDENCIES)) {
    if (deps.silver.includes(silverTable)) {
      downstream.push(table);
      // Recursively find downstream of downstream
      const transitive = getDownstreamSilverTables(table);
      downstream.push(...transitive);
    }
  }

  return downstream;
}

/**
 * Compute processing order using topological sort
 */
export function getProcessingOrder(
  tables: string[]
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(table: string) {
    if (visited.has(table)) return;
    visited.add(table);

    const deps = SILVER_DEPENDENCIES[table];
    if (!deps) {
      throw new Error(`No dependencies defined for table: ${table}`);
    }

    // Visit Silver dependencies first (Bronze/Local are always available)
    for (const dep of deps.silver) {
      visit(dep);
    }

    order.push(table);
  }

  for (const table of tables) {
    visit(table);
  }

  return order;
}

async function processTable(
  table: string,
  options?: { dateRange?: { from: Date; to: Date } }
) {
  // Import handlers lazily to avoid circular dependencies at module load time
  const handlers: Record<string, () => Promise<{ POST: (req: any) => Promise<any> }>> = {
    members: () => import('@/app/api/process/members/route'),
    calendar: () => import('@/app/api/process/calendar/route'),
    attendance: () => import('@/app/api/process/attendance/route'),
    slack: () => import('@/app/api/process/slack/route'),
  };

  const handlerLoader = handlers[table];
  if (!handlerLoader) {
    throw new Error(`No handler registered for table: ${table}`);
  }

  const deps = SILVER_DEPENDENCIES[table];

  // Determine scope based on table config
  let body: any = {};

  if (deps.processingScope === 'date-range') {
    if (!options?.dateRange) {
      throw new Error(`Table ${table} requires dateRange but none provided`);
    }
    body = {
      fromDate: options.dateRange.from.toISOString(),
      toDate: options.dateRange.to.toISOString()
    };
  }

  // Call the handler directly (no HTTP round-trip — avoids Vercel deployment protection)
  const { NextRequest } = await import('next/server');
  const url = new URL(`http://internal/api/process/${table}`);
  const request = new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const { POST } = await handlerLoader();
  const response = await POST(request);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to process ${table}: ${error}`);
  }

  return response.json();
}

/**
 * Trigger Kajabi API sync (Bronze layer import) then Silver reprocessing.
 * Called by the member reconciliation cron and the UI sync button.
 */
export async function triggerKajabiSync() {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('@/app/api/import/kajabi/route');
  const req = new NextRequest(new URL('http://internal/api/import/kajabi'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({}),
  });
  const response = await POST(req);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kajabi sync failed: ${error}`);
  }
  return response.json();
}

/**
 * Trigger Slack API sync (Bronze layer import) then Silver reprocessing.
 * Called by the Slack reconciliation cron and the UI sync button.
 *
 * Backstops the Slack Events API webhook — catches anything a missed or
 * failed webhook delivery would otherwise drop permanently, since Slack
 * does not replay events beyond its own short retry window.
 */
export async function triggerSlackSync(options?: { daysBack?: number }) {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('@/app/api/import/slack-api/route');
  const req = new NextRequest(new URL('http://internal/api/import/slack-api'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ daysBack: options?.daysBack ?? 90 }),
  });
  const response = await POST(req);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Slack sync failed: ${error}`);
  }
  return response.json();
}

/**
 * Trigger Google Calendar sync (Bronze layer import) then Silver reprocessing.
 * Called by the calendar webhook to avoid VERCEL_URL deployment protection issues.
 */
export async function triggerCalendarSync(options: { daysBack: number; daysForward: number }) {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('@/app/api/import/calendar/route');
  const req = new NextRequest(new URL('http://internal/api/import/calendar'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(options),
  });
  const response = await POST(req);
  if (!response.ok) {
    throw new Error(`Calendar sync failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Trigger Zoom attendance import (Bronze layer import).
 * Called by the Zoom webhook to avoid VERCEL_URL deployment protection issues.
 */
export async function triggerZoomImport(options: { fromDate: string; toDate: string }) {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('@/app/api/import/zoom/route');
  const req = new NextRequest(new URL('http://internal/api/import/zoom'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(options),
  });
  const response = await POST(req);
  if (!response.ok) {
    throw new Error(`Zoom import failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Trigger attendance reprocessing directly for a specific date range.
 *
 * Use this after member changes (new members added, status changes) to fix
 * any attendance gaps without re-running member or calendar processing.
 * Attendance processing fetches fresh members from the DB, so calling this
 * after reprocess_members_atomic will pick up any newly-matchable names.
 */
export async function triggerAttendanceReprocessing(dateRange: { from: Date; to: Date }) {
  console.log(`Triggering targeted attendance reprocessing: ${dateRange.from.toISOString()} to ${dateRange.to.toISOString()}`);
  return processTable('attendance', { dateRange });
}

/**
 * Trigger downstream Silver layer reprocessing when Bronze/Local data changes
 */
export async function triggerReprocessing(
  changedTable: string,
  layer: 'bronze' | 'local',
  options?: { dateRange?: { from: Date; to: Date } }
) {
  // Find affected Silver tables
  const affected = getAffectedSilverTables(changedTable, layer);

  if (affected.length === 0) {
    console.log(`No Silver tables affected by ${layer}.${changedTable}`);
    return { processed: [] };
  }

  // Compute processing order first (needed for date range calculation)
  const order = getProcessingOrder(affected);

  // For Local layer changes without explicit date range, default to last 90 days
  // plus any forward window needed by affected tables (e.g. calendar has pre-scheduled future events)
  let dateRange = options?.dateRange;
  if (layer === 'local' && !dateRange) {
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const maxFutureDays = Math.max(
      0,
      ...order.map(t => SILVER_DEPENDENCIES[t]?.localDefaultFutureDays ?? 0)
    );
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + maxFutureDays);

    dateRange = { from: ninetyDaysAgo, to: futureDate };
    console.log(`Local layer change: defaulting to last 90 days + ${maxFutureDays} days forward (${ninetyDaysAgo.toISOString()} to ${futureDate.toISOString()})`);
  }

  console.log(`Reprocessing ${order.join(' → ')} due to ${layer}.${changedTable} change`);

  const results = [];
  for (const table of order) {
    try {
      const result = await processTable(table, { dateRange });
      results.push({ table, success: true, ...result });
    } catch (error: any) {
      console.error(`Failed to process ${table}:`, error);
      results.push({ table, success: false, error: error.message });
    }
  }

  return { processed: results };
}
