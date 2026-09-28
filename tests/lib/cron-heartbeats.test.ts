import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  CRON_HEARTBEATS,
  pingCronHeartbeat,
  withCronHeartbeat,
} from "@/lib/cron-heartbeats";
import { ENV_VARS } from "@/env-vars.config";

const ENV_VAR = CRON_HEARTBEATS["reconcile-calendar"].envVar;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CRON_HEARTBEATS coverage", () => {
  it("has a heartbeat for every Vercel cron in vercel.json", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    const cronPaths: string[] = vercel.crons.map((c: { path: string }) => c.path).sort();
    const heartbeatPaths = Object.values(CRON_HEARTBEATS)
      .filter((h) => h.scheduler === "vercel")
      .map((h) => h.path)
      .sort();
    expect(heartbeatPaths).toEqual(cronPaths);
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
