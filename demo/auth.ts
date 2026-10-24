import { createServerClient } from "@supabase/ssr";
import type { Cookie } from "playwright/test";
import { loadDemoEnv } from "./env";
import { DEMO_PASSWORD, persona } from "./personas";

/**
 * A browser session for a demo persona, from a real password sign-in against the demo stack. The cookies are the
 * ones the app's own Supabase client writes, so the pages run as that user under RLS and the admin checks. The
 * service role key stays in the seed; it never reaches the browser.
 */
export async function sessionCookies(personaKey: string): Promise<Cookie[]> {
  const env = loadDemoEnv();
  const jar = new Map<string, string>();
  const supabase = createServerClient(env.supabaseUrl, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { email } = persona(personaKey);
  const { error } = await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) throw new Error(`Sign-in as ${personaKey} failed: ${error.message}. Has \`pnpm demo:seed\` run?`);
  const { hostname } = new URL(env.appUrl);
  return [...jar].map(([name, value]) => ({
    name,
    value,
    domain: hostname,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));
}
