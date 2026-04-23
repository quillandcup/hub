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
}

export const SILVER_DEPENDENCIES: Record<string, TableDependencies> = {
  members: {
    bronze: ['kajabi_members'],
    local: ['member_email_aliases'],
    silver: [],
    processingScope: 'full'  // Entity state, no date scoping
  },

  hiatus: {
    bronze: ['subscription_history'],
    local: [],
    silver: ['members'],  // Must process members first to have member IDs
    processingScope: 'full'  // Process all subscription history snapshots
  },

  prickles: {
    bronze: ['calendar_events', 'zoom_meetings'],
    local: ['prickle_types'],
    silver: [],
    processingScope: 'date-range',
    dateField: 'prickle_date'
  },

  attendance: {
    bronze: ['zoom_attendees'],
    local: ['member_name_aliases', 'ignored_zoom_names'],
    silver: ['members', 'prickles'],  // Must process members and prickles first
    processingScope: 'date-range',
    dateField: 'prickle_date'
  }
};

/**
 * Find which Silver tables are affected by a Bronze/Local table change
 *
 * IMPORTANT: Silver dependencies are processing order constraints, NOT change propagation.
 * Only Bronze/Local dependencies trigger reprocessing.
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

  // Do NOT propagate to downstream Silver tables
  // Silver dependencies are for ordering, not change propagation
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
  const deps = SILVER_DEPENDENCIES[table];
  const route = `/api/process/${table.replace('_', '-')}`;

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
  // else: full table reprocessing, no parameters needed

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Use service role key to bypass auth (internal processing)
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to process ${table}: ${error}`);
  }

  return response.json();
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

  // For Local layer changes without explicit date range, default to last 90 days
  let dateRange = options?.dateRange;
  if (layer === 'local' && !dateRange) {
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    dateRange = { from: ninetyDaysAgo, to: now };
    console.log(`Local layer change: defaulting to last 90 days (${ninetyDaysAgo.toISOString()} to ${now.toISOString()})`);
  }

  // Process in correct order
  const order = getProcessingOrder(affected);

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
