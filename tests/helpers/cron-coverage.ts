export interface HeartbeatLike {
  readonly path: string;
  readonly scheduler: "vercel" | "pg_cron";
}

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface CoverageGaps {
  /** Scheduled routes with no heartbeat entry. */
  missingHeartbeat: string[];
  /** Heartbeat entries whose route no scheduler calls. */
  staleHeartbeat: string[];
}

function diff(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return [...new Set(a)].filter((x) => !set.has(x)).sort();
}

function gaps(scheduled: string[], heartbeats: string[]): CoverageGaps {
  return { missingHeartbeat: diff(scheduled, heartbeats), staleHeartbeat: diff(heartbeats, scheduled) };
}

export function vercelCronGaps(vercel: { crons?: { path: string }[] }, heartbeats: readonly HeartbeatLike[]): CoverageGaps {
  return gaps(
    (vercel.crons ?? []).map((c) => c.path),
    heartbeats.filter((h) => h.scheduler === "vercel").map((h) => h.path),
  );
}

/**
 * Migrations apply in filename order and re-scheduling a job name replaces it, so the last
 * migration to mention a job name defines what it calls. Returns job name -> route (undefined
 * when the job's SQL never calls an /api/ route).
 */
export function pgCronRoutes(migrations: MigrationFile[]): Map<string, string | undefined> {
  const routeByJob = new Map<string, string | undefined>();
  for (const file of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = file.sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const block of sql.split(/(?=cron\.schedule\()/).slice(1)) {
      const name = block.match(/^cron\.schedule\(\s*'([^']+)'/)?.[1];
      if (name) routeByJob.set(name, block.match(/'(\/api\/[^']+)'/)?.[1]);
    }
    for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'/g)) routeByJob.delete(m[1]);
  }
  return routeByJob;
}

export function pgCronGaps(migrations: MigrationFile[], heartbeats: readonly HeartbeatLike[]): CoverageGaps & { jobsWithoutRoute: string[] } {
  const routeByJob = pgCronRoutes(migrations);
  return {
    ...gaps(
      [...routeByJob.values()].filter((r): r is string => !!r),
      heartbeats.filter((h) => h.scheduler === "pg_cron").map((h) => h.path),
    ),
    jobsWithoutRoute: [...routeByJob].filter(([, route]) => !route).map(([name]) => name),
  };
}
