import { createClient as createServiceClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { NextResponse, type NextRequest } from "next/server";

// Public endpoint for external uptime monitors (e.g. UptimeRobot, BetterStack).
// No auth required -- see the isPublic check in lib/supabase/middleware.ts.
export const dynamic = "force-dynamic";

// Module scope survives across requests on a warm instance, so this tells a
// cold start apart from a warm one in the Server-Timing output.
let servedCount = 0;

// Opens (and closes) a throwaway TCP+TLS connection to the Supabase host so
// connection setup can be timed apart from the query itself.
function timeHandshake(host: string, address: string, timings: Record<string, number>) {
  return new Promise<void>((resolve, reject) => {
    const start = performance.now();
    const socket = tcpConnect({ host: address, port: 443 }, () => {
      timings.tcp = performance.now() - start;
      const tlsStart = performance.now();
      const secure = tlsConnect({ socket, servername: host }, () => {
        timings.tls = performance.now() - tlsStart;
        secure.destroy();
        resolve();
      });
      secure.on("error", reject);
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => socket.destroy(new Error("handshake timeout")));
  });
}

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createServiceClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const coldStart = servedCount++ === 0;
  // ?timing=1 breaks connection setup (DNS, TCP, TLS) out from query time,
  // repeats the query on the now-warm connection, and reports which
  // Cloudflare POP answered, to diagnose slow first calls to Supabase.
  const detailed = request.nextUrl.searchParams.get("timing") === "1";

  const timings: Record<string, number> = {};
  const time = async <T,>(name: string, fn: () => PromiseLike<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = performance.now() - start;
    }
  };
  const serverTiming = () =>
    Object.entries(timings)
      .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
      .concat(`cold;desc="${coldStart}"`)
      .join(", ");

  try {
    let diagnostics: Record<string, unknown> = {};
    if (detailed) {
      // Diagnostics must never fail the health check itself.
      try {
        const { hostname, protocol } = new URL(url);
        const addresses = await time("dns", () => lookup(hostname, { all: true }));
        diagnostics = { coldStart, family: addresses.map((a) => `v${a.family}`) };
        // Local Supabase is plain http, so there is no TLS handshake to time.
        if (protocol === "https:") await timeHandshake(hostname, addresses[0].address, timings);
      } catch (err) {
        diagnostics.handshakeError = String(err);
      }
    }

    const { error } = await time("db", () => supabase.from("members").select("id").limit(1));
    if (error) throw error;

    if (detailed) {
      const res = await time("db_warm", () =>
        fetch(`${url}/rest/v1/members?select=id&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        })
      );
      await res.arrayBuffer();
      diagnostics.pop = res.headers.get("cf-ray")?.split("-").pop();
      diagnostics.upstreamMs = res.headers.get("x-envoy-upstream-service-time");
    }

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        ...(detailed && { timings, ...diagnostics }),
      },
      { headers: { "Server-Timing": serverTiming() } }
    );
  } catch (err) {
    console.error("Health check failed:", err);
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503, headers: { "Server-Timing": serverTiming() } }
    );
  }
}
