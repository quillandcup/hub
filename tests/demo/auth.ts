import { createServerClient } from "@supabase/ssr";
import type { Cookie } from "playwright/test";
import { loadDemoEnv } from "./env";
import { DEMO_PASSWORD, persona } from "./personas";
import { totp } from "./totp";

/**
 * A browser session for a demo persona, from a real password sign-in against the demo stack. The cookies are the
 * ones the app's own Supabase client writes, so the pages run as that user under RLS and the admin checks. The
 * service role key stays in the seed; it never reaches the browser.
 */
export async function sessionCookies(personaKey: string, options: { twoStep?: boolean } = {}): Promise<Cookie[]> {
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
  if (options.twoStep) {
    // A staff session that has also passed the second step (a code from an authenticator app), so the admin pages show no
    // "set up two-step sign-in" reminder. The factor is real; the scene removes it afterwards (`removeTwoStep`, tests/demo/db.ts).
    const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `demo-${Date.now()}` });
    if (enrolled.error) throw new Error(`Two-step set-up for ${personaKey} failed: ${enrolled.error.message}`);
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrolled.data.id });
    if (challenge.error) throw new Error(`Two-step challenge for ${personaKey} failed: ${challenge.error.message}`);
    const verified = await supabase.auth.mfa.verify({ factorId: enrolled.data.id, challengeId: challenge.data.id, code: totp(enrolled.data.totp.secret) });
    if (verified.error) throw new Error(`Two-step code for ${personaKey} was refused: ${verified.error.message}`);
  }
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
