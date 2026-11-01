import { readFileSync } from "node:fs";
import path from "node:path";

// Playwright loads this file as CommonJS, so no import.meta: every demo command runs from the repo root.

export interface DemoEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  appUrl: string;
}

/** The demo stack's URLs and keys, from demo/.env.demo (written by `pnpm demo:stack up`). Never from the process environment, so a seed can't be pointed at another database by a stray variable. */
export function loadDemoEnv(): DemoEnv {
  let text: string;
  try {
    text = readFileSync(path.join(process.cwd(), "demo", ".env.demo"), "utf8");
  } catch {
    throw new Error("demo/.env.demo is missing: run `pnpm demo:stack up` first.");
  }
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) values.set(m[1], m[2]);
  }
  const need = (name: string) => {
    const v = values.get(name);
    if (!v) throw new Error(`${name} is missing from demo/.env.demo`);
    return v;
  };
  const supabaseUrl = need("NEXT_PUBLIC_SUPABASE_URL");
  assertLocal(supabaseUrl);
  return {
    supabaseUrl,
    anonKey: need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    appUrl: process.env.DEMO_APP_URL ?? "http://localhost:3100",
  };
}

/** The seed writes with the service role, so it only ever runs against a local stack. */
export function assertLocal(url: string) {
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") {
    throw new Error(`Refusing to run against ${hostname}: the demo only uses the local stack.`);
  }
}
