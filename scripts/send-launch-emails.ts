#!/usr/bin/env npx tsx
// Sends the "Hedgie Hub is open" email, with each member's own sign-in code, in batches.
//
//   pnpm launch:email                         plan: counts only, nothing sent (default)
//   pnpm launch:email --test                  send ONE email, rendered for a sample code, to EMAIL_DEV_ADDRESS; marks nobody
//   pnpm launch:email --apply --limit=2       really send at most 2
//   pnpm launch:email --apply                 really send to everyone eligible, 20 at a time, a minute apart
//   options: --batch=N (default 20)  --pause=SECONDS (default 60)
//
// Eligible: active members whose account is released (not banned), who have not signed in and have
// not had this email. A re-run skips whoever was already sent one. Run `pnpm auth:precreate release`
// first. Output is counts and member ids only: no emails, no names. Resend's free plan allows 100
// emails a day: use --limit to stay under what is left.

import { createClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Database } from "@/lib/data/database.types";
import { sendEmail } from "@/lib/email";
import { LAUNCH_EMAIL_SUBJECT, renderLaunchEmail, sendLaunchEmails, type LaunchAuthApi } from "@/lib/launch-email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const testOnly = args.includes("--test");
const known = (a: string) => a === "--apply" || a === "--test" || /^--(limit|batch|pause)=/.test(a);
const unknown = args.find((a) => !known(a));
if (unknown) {
  console.error(`Unknown argument ${unknown}. Use --test, --apply, --limit=N, --batch=N, --pause=SECONDS.`);
  process.exit(1);
}
const num = (name: string): number | undefined => {
  const raw = args.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return undefined;
  const n = Number(raw.slice(name.length + 3));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--${name} must be a positive whole number.`);
    process.exit(1);
  }
  return n;
};
const limit = num("limit");
const batchSize = num("batch");
const pause = num("pause");
if (apply && testOnly) {
  console.error("Use either --test or --apply, not both.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (run through the package script).");
  process.exit(1);
}

async function main() {
  console.log(`Target: ${new URL(url!).host}`);
  if (testOnly) {
    // lib/email.ts redirects to EMAIL_DEV_ADDRESS unless EMAIL_TEST_MODE=false: keep it on.
    process.env.EMAIL_TEST_MODE = "true";
    const mail = await renderLaunchEmail("12345678");
    await sendEmail({ to: "(test mode: goes to EMAIL_DEV_ADDRESS)", ...mail });
    console.log(`Test email "${LAUNCH_EMAIL_SUBJECT}" sent to EMAIL_DEV_ADDRESS. Nobody was marked.`);
    return;
  }
  if (apply) process.env.EMAIL_TEST_MODE = "false";

  const db = createClient<Database>(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });
  const auth = db.auth.admin as unknown as LaunchAuthApi;
  console.log(`Mode: ${apply ? "--apply (SENDS REAL EMAIL)" : "plan (dry run, nothing is sent)"}`);
  const report = await sendLaunchEmails(auth, createRepos(db).members, sendEmail, {
    apply,
    limit,
    batchSize,
    pauseMs: pause === undefined ? undefined : pause * 1000,
  });
  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.log("Dry run only. Add --apply to send.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
