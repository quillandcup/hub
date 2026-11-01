// The Slack bot's rotating token (lib/slack-bot-token.ts), by hand:
//
//   pnpm slack:bot-token status               when the stored credential expires (never prints a token)
//   pnpm slack:bot-token exchange --confirm   the one-time exchange of the long-lived SLACK_BOT_TOKEN for a
//                                             rotating one, stored in Vault
//   pnpm slack:bot-token seed --confirm       recovery: replace the stored credential with an access and refresh token
//                                             you paste at the prompts (after a reinstall, when the stored refresh
//                                             token is gone). Checks the access token with Slack first.
//
// Runs against whatever Supabase project and Slack app the loaded env files point at (the package script
// loads .env.prod and .env.shared). The exchange is for after the Slack app has opted into token rotation
// (token_rotation_enabled in slack-app-manifest.yml, pushed by CI) and the code that reads the stored token
// is deployed: docs/SECRET_ROTATION.md, "Moving the bot to rotating tokens", has the whole order. A long-lived
// token can be exchanged only once, so this refuses to run twice and asks for --confirm.

import { createClient } from "@supabase/supabase-js";
import { WebClient } from "@slack/web-api";
import { createInterface } from "node:readline/promises";
import { botTokenStatus, exchangeBotToken, seedBotToken } from "../lib/slack-bot-token";

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
    if (!status) console.log("No rotating bot token is stored yet: the bot still uses SLACK_BOT_TOKEN.");
    else console.log(`A rotating bot token is stored${status.expiresAt ? `; its current access token expires ${status.expiresAt.toISOString()}` : ""}.`);
    return;
  }

  if (command === "exchange") {
    if (!flags.includes("--confirm")) {
      console.error("This exchanges the bot's long-lived token for a rotating one. It can't be undone and works once per token.");
      console.error("Check docs/SECRET_ROTATION.md first, then re-run with --confirm.");
      process.exit(1);
    }
    if (await botTokenStatus(service)) {
      console.error("✗ A rotating bot token is already stored; exchanging again would waste the long-lived token it came from.");
      process.exit(1);
    }
    need("SLACK_CLIENT_ID");
    need("SLACK_CLIENT_SECRET");
    const { expiresAt } = await exchangeBotToken(service, need("SLACK_BOT_TOKEN"));
    console.log(`✓ Stored a rotating bot token (first expiry ${expiresAt.toISOString()}).`);
    console.log("  Next: set SLACK_BOT_TOKEN_ROTATION=on for production (pnpm env:sync --only=SLACK_BOT_TOKEN_ROTATION --target=production) and redeploy.");
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
    const check = await new WebClient(accessToken).auth.test();
    if (!check.ok) throw new Error("Slack rejected that access token. Nothing stored.");
    await seedBotToken(service, accessToken, refreshToken);
    console.log(`✓ Stored. Slack says it is ${check.user} in ${check.team}; the first use will refresh it, so the next token is stored by the app itself.`);
    return;
  }

  console.error("Usage: slack-bot-token.ts status | exchange --confirm | seed --confirm");
  process.exit(1);
}

main().catch((error) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
