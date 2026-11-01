import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The public uptime endpoint: one cheap query through a service-role client, with the time Supabase
// reported for it. The client is replaced; what is checked is the answer and the headers monitors read.
type Options = { global: { fetch: (...args: Parameters<typeof fetch>) => Promise<Response> } };
let options: Options;
let queryError: Error | null = null;
let upstreamHeader: string | null = null;
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, opts: Options) => {
    options = opts;
    return {
      from: () => ({
        select: () => ({
          limit: async () => {
            // The client's own fetch is what captures Supabase's reported processing time.
            await opts.global.fetch("http://127.0.0.1:54321/rest/v1/members");
            return { error: queryError };
          },
        }),
      }),
    };
  },
}));

import { GET } from "@/app/api/health/route";

const call = (query = "") => GET(new NextRequest(`http://localhost/api/health${query}`));

beforeEach(() => {
  queryError = null;
  upstreamHeader = "12";
  vi.stubGlobal("fetch", async () => new Response("", { headers: upstreamHeader ? { "x-envoy-upstream-service-time": upstreamHeader } : {} }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/health", () => {
  it("answers ok with the time the query took, and what Supabase reported for it", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
    const timing = res.headers.get("Server-Timing")!;
    expect(timing).toMatch(/db;dur=/);
    expect(timing).toContain("db_upstream;dur=12.0");
    expect(timing).toMatch(/cold;desc="(true|false)"/);
  });

  it("leaves the upstream time out when Supabase did not report one", async () => {
    upstreamHeader = null;

    expect((await call()).headers.get("Server-Timing")).not.toContain("db_upstream");
  });

  it("answers 503 when the query fails", async () => {
    queryError = new Error("connection refused");

    const res = await call();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "error" });
    expect(options).toBeDefined();
  });
});
