#!/usr/bin/env npx tsx
// Collapses the check-in and check-out DMs that are still open in people's inboxes although the
// check-in is done on the site (lib/prickle-checkin-dm-cleanup.ts). Run once after the Submit button ships.
//
//   pnpm checkin-dms:close                 dry run: counts only (default)
//   pnpm checkin-dms:close --apply         collapse them
//   pnpm checkin-dms:close --days=30       how far back to look (default 14)
//
// Targets whatever the env files say (.env.prod via the package script). Output is counts only.

import { createClient } from "@supabase/supabase-js";
import { WebClient } from "@slack/web-api";
import { createRepos } from "@/lib/data/repos";
import type { Database } from "@/lib/data/database.types";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { closeAnsweredCheckinDms } from "@/lib/prickle-checkin-dm-cleanup";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const daysArg = args.find((a) => a.startsWith("--days="));
const days = daysArg ? Number(daysArg.slice("--days=".length)) : 14;
const unknown = args.find((a) => a !== "--apply" && !a.startsWith("--days="));
if (unknown || !Number.isInteger(days) || days < 1) {
  console.error("Usage: --apply and --days=N (a positive whole number).");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const token = await getSlackBotToken();
if (!url || !key || !token) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the Slack bot token must be set (run through the package script).");
  process.exit(1);
}

const repos = createRepos(createClient<Database>(url, key));
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const result = await closeAnsweredCheckinDms(repos, new WebClient(token), { since, dryRun: !apply });
console.log(apply ? "Applied:" : "Dry run:", result);
