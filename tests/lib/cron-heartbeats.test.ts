import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  CRON_HEARTBEATS,
  pingCronHeartbeat,
  withCronHeartbeat,
} from "@/lib/cron-heartbeats";
import { ENV_VARS } from "@/env-vars.config";
import { pgCronGaps, vercelCronGaps } from "../helpers/cron-coverage";

const ENV_VAR = CRON_HEARTBEATS["reconcile-calendar"].envVar;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CRON_HEARTBEATS coverage", () => {
  it("has a heartbeat for every Vercel cron in vercel.json", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercelCronGaps(vercel, Object.values(CRON_HEARTBEATS))).toEqual({
      missingHeartbeat: [],
      staleHeartbeat: [],
    });
  });

  it("has a heartbeat for every pg_cron job scheduled in supabase/migrations", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const migrations = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
    expect(pgCronGaps(migrations, Object.values(CRON_HEARTBEATS))).toEqual({
      missingHeartbeat: [],
      staleHeartbeat: [],
      jobsWithoutRoute: [],
    });
  });

  it("declares every heartbeat env var in env-vars.config.ts", () => {
    const declared = new Set(ENV_VARS.map((v) => v.name));
    for (const h of Object.values(CRON_HEARTBEATS)) {
      expect(declared.has(h.envVar), h.envVar).toBe(true);
    }
  });

  it("pings from each job's route", () => {
    for (const [job, h] of Object.entries(CRON_HEARTBEATS)) {
      const src = fs.readFileSync(path.join(process.cwd(), "app", h.path, "route.ts"), "utf8");
      expect(src, h.path).toMatch(new RegExp(`CronHeartbeat\\("${job}"`));
    }
  });
});

// Guards the guards: the coverage checks above must actually fail when a job is unmonitored.
describe("cron coverage checks catch gaps", () => {
  const heartbeats = [
    { path: "/api/reconcile/a", scheduler: "vercel" },
    { path: "/api/internal/b", scheduler: "pg_cron" },
  ] as const;
  const schedule = (name: string, route: string) =>
    `select cron.schedule('${name}', '*/5 * * * *', $$ select net.http_post(url := base || '${route}') $$);`;

  it("flags a Vercel cron with no heartbeat", () => {
    const vercel = { crons: [{ path: "/api/reconcile/a" }, { path: "/api/reconcile/new" }] };
    expect(vercelCronGaps(vercel, heartbeats)).toEqual({
      missingHeartbeat: ["/api/reconcile/new"],
      staleHeartbeat: [],
    });
  });

  it("flags a Vercel heartbeat whose cron was removed", () => {
    expect(vercelCronGaps({ crons: [] }, heartbeats)).toEqual({
      missingHeartbeat: [],
      staleHeartbeat: ["/api/reconcile/a"],
    });
  });

  it("flags a pg_cron job with no heartbeat", () => {
    const migrations = [
      { name: "001.sql", sql: schedule("b-job", "/api/internal/b") },
      { name: "002.sql", sql: schedule("new-job", "/api/internal/new") },
    ];
    expect(pgCronGaps(migrations, heartbeats)).toEqual({
      missingHeartbeat: ["/api/internal/new"],
      staleHeartbeat: [],
      jobsWithoutRoute: [],
    });
  });

  it("flags a pg_cron heartbeat with no scheduled job, including after an unschedule", () => {
    const migrations = [
      { name: "001.sql", sql: schedule("b-job", "/api/internal/b") },
      { name: "002.sql", sql: "select cron.unschedule('b-job');" },
    ];
    expect(pgCronGaps(migrations, heartbeats)).toEqual({
      missingHeartbeat: [],
      staleHeartbeat: ["/api/internal/b"],
      jobsWithoutRoute: [],
    });
  });

  it("uses the latest migration's route when a job is re-scheduled", () => {
    const migrations = [
      { name: "002.sql", sql: schedule("b-job", "/api/internal/moved") },
      { name: "001.sql", sql: schedule("b-job", "/api/internal/b") },
    ];
    expect(pgCronGaps(migrations, heartbeats).missingHeartbeat).toEqual(["/api/internal/moved"]);
  });

  it("flags a pg_cron job that calls no /api route, and ignores commented-out jobs", () => {
    const migrations = [
      { name: "001.sql", sql: "select cron.schedule('vacuum-job', '0 * * * *', $$ vacuum $$);" },
      { name: "002.sql", sql: `-- ${schedule("ghost", "/api/internal/ghost")}` },
    ];
    expect(pgCronGaps(migrations, [])).toEqual({
      missingHeartbeat: [],
      staleHeartbeat: [],
      jobsWithoutRoute: ["vacuum-job"],
    });
  });
});

describe("pingCronHeartbeat", () => {
  it("does nothing when the env var is unset", async () => {
    vi.stubEnv(ENV_VAR, "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await pingCronHeartbeat("reconcile-calendar");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs the configured URL", async () => {
    vi.stubEnv(ENV_VAR, "https://ping.checklyhq.com/abc");
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK"));
    vi.stubGlobal("fetch", fetchMock);
    await pingCronHeartbeat("reconcile-calendar");
    expect(fetchMock).toHaveBeenCalledWith("https://ping.checklyhq.com/abc", expect.anything());
  });

  it("swallows network errors", async () => {
    vi.stubEnv(ENV_VAR, "https://ping.checklyhq.com/abc");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(pingCronHeartbeat("reconcile-calendar")).resolves.toBeUndefined();
  });
});

describe("withCronHeartbeat", () => {
  it("pings on success and not on failure, returning the response unchanged", async () => {
    vi.stubEnv(CRON_HEARTBEATS["pre-prickle-nudges"].envVar, "https://ping.checklyhq.com/n");
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK"));
    vi.stubGlobal("fetch", fetchMock);

    const failed = new Response(null, { status: 401 });
    expect(await withCronHeartbeat("pre-prickle-nudges", failed)).toBe(failed);
    expect(fetchMock).not.toHaveBeenCalled();

    const ok = new Response("{}", { status: 200 });
    expect(await withCronHeartbeat("pre-prickle-nudges", ok)).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
