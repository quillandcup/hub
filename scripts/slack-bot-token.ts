// The Slack bot's rotating token (lib/slack-bot-token.ts), by hand:
//
//   pnpm slack:bot-token status               when the stored credential expires (never prints a token)
//   pnpm slack:bot-token seed --confirm       recovery: replace the stored credential with an access and refresh token
//                                             you paste at the prompts (after a reinstall, when the stored refresh
//                                             token is gone). Checks the access token with Slack first.
//
// Runs against whatever Supabase project and Slack app the loaded env files point at (the package script
// loads .env.prod and .env.shared). docs/SECRET_ROTATION.md, "The bot's rotating token", has the recovery order.

import { createClient } from "@supabase/supabase-js";
import { createSlackClient } from "@/lib/slack-client";
import { createInterface } from "node:readline/promises";
import { botTokenStatus, seedBotToken } from "../lib/slack-bot-token";

const [command, ...flags] = process.argv.slice(2);

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is not set`);
    process.exit(1);
  }
  return value;
}

const service = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  if (command === "status") {
    const status = await botTokenStatus(service);
    if (!status) console.log("No rotating bot token is stored: the bot has no token. Recover with seed --confirm or /api/oauth/slack/bot/start.");
    else console.log(`A rotating bot token is stored${status.expiresAt ? `; its current access token expires ${status.expiresAt.toISOString()}` : ""}.`);
    return;
  }

  if (command === "seed") {
    if (!flags.includes("--confirm")) {
      console.error("This replaces the stored bot credential with tokens you paste, for recovery after a reinstall. Re-run with --confirm.");
      process.exit(1);
    }
    // Asked for here, not taken from the command line, so they don't end up in shell history.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const accessToken = (await rl.question("Access token (xoxe.xoxb-...): ")).trim();
    const refreshToken = (await rl.question("Refresh token (xoxe-1-...): ")).trim();
    rl.close();
    if (!accessToken.startsWith("xoxe.xoxb-") || !refreshToken.startsWith("xoxe-")) {
      console.error("✗ Those don't look like a rotating bot token pair (xoxe.xoxb-... and xoxe-...). Nothing stored.");
      process.exit(1);
    }
    const check = await createSlackClient(accessToken).auth.test();
    if (!check.ok) throw new Error("Slack rejected that access token. Nothing stored.");
    await seedBotToken(service, accessToken, refreshToken);
    console.log(`✓ Stored. Slack says it is ${check.user} in ${check.team}; the first use will refresh it, so the next token is stored by the app itself.`);
    return;
  }

  console.error("Usage: slack-bot-token.ts status | seed --confirm");
  process.exit(1);
}

main().catch((error) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
