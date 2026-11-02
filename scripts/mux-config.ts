#!/usr/bin/env npx tsx
// Diffs or pushes mux-config.yml against the live Mux environment, so the webhook and the
// playback restriction are reviewed in git instead of clicked in the dashboard. Run by hand
// (never from CI); `pnpm mux:config:diff` is read-only. See docs/MUX_CONFIG.md.
//
//   tsx scripts/mux-config.ts diff            what a push would change (read-only)
//   tsx scripts/mux-config.ts push            apply it
//   tsx scripts/mux-config.ts diff|push --dev a developer's own Mux environment: only the webhook,
//                                             pointing at https://$TUNNEL_DOMAIN/api/webhooks/mux
//   --adopt                                   when exactly one webhook exists at another address and it is this
//                                             app's, move it to the configured address (keeps its signing secret)
//   --replace-secret                          allow creating a webhook although MUX_WEBHOOK_SECRET
//                                             already has a value in the env file (it is replaced)
//
// Env: MUX_SYSTEM_TOKEN_ID / MUX_SYSTEM_TOKEN_SECRET, a Mux access token with the System
// permission (webhooks). Without it, only the playback restriction can be read or changed, with
// MUX_TOKEN_ID / MUX_TOKEN_SECRET. A new webhook's signing secret is shown by Mux once; it is
// written straight into the env file (.env.prod, or .env.local with --dev) and never printed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import appConfig from "../app.config";
import { devWebhookAddress, envValue, parseMuxConfig, planRestriction, planWebhook, restrictionBody, setEnvValue, unmanagedWebhooks, webhookAddress, type LiveRestriction, type LiveWebhook, describeAddress } from "../lib/mux-config";

const API = "https://api.mux.com";
const [command, ...flags] = process.argv.slice(2);
const dev = flags.includes("--dev");
const replaceSecret = flags.includes("--replace-secret");
// Production: when exactly one webhook exists at another address and it is ours, move it instead of creating a second one.
const adopt = flags.includes("--adopt");
const envFile = dev ? ".env.local" : ".env.prod";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (command !== "diff" && command !== "push") fail("usage: mux-config.ts diff|push [--dev] [--replace-secret] [--adopt]");
const push = command === "push";

const systemAuth =
  process.env.MUX_SYSTEM_TOKEN_ID && process.env.MUX_SYSTEM_TOKEN_SECRET
    ? { id: process.env.MUX_SYSTEM_TOKEN_ID, secret: process.env.MUX_SYSTEM_TOKEN_SECRET }
    : null;
const appAuth =
  process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET
    ? { id: process.env.MUX_TOKEN_ID, secret: process.env.MUX_TOKEN_SECRET }
    : null;

async function mux<T>(
  auth: { id: string; secret: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | undefined }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${auth.id}:${auth.secret}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { messages?: string[] } };
  if (!res.ok && res.status !== 403) {
    fail(`${method} ${path}: HTTP ${res.status} ${json.error?.messages?.join("; ") ?? ""}`);
  }
  return { status: res.status, data: json.data };
}

async function listAll<T>(auth: { id: string; secret: string }, path: string): Promise<T[] | null> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const { status, data } = await mux<T[]>(auth, "GET", `${path}?limit=100&page=${page}`);
    if (status === 403) return null; // token lacks the permission
    rows.push(...(data ?? []));
    if (!data || data.length < 100) return rows;
  }
}

const config = parseMuxConfig(parseYaml(readFileSync("mux-config.yml", "utf8")), new URL(appConfig.appUrl).host);
let changes = 0;
const note = (line: string) => console.log(line);

async function webhooks() {
  const tunnel = process.env.TUNNEL_DOMAIN;
  if (dev && !tunnel) fail("--dev needs TUNNEL_DOMAIN in .env.local (docs/WEBHOOK_SETUP.md)");
  const address = dev ? devWebhookAddress(tunnel!, config.webhookPath) : webhookAddress(appConfig.appUrl, config.webhookPath);
  if (!systemAuth) {
    note("webhooks: not checked (set MUX_SYSTEM_TOKEN_ID/SECRET, a token with the System permission)");
    return;
  }
  const live = await listAll<LiveWebhook>(systemAuth, "/system/v1/webhooks");
  if (!live) {
    note("webhooks: not checked (the System token was refused: it needs the System permission)");
    return;
  }
  const action = planWebhook(address, live, { adoptSingle: dev || adopt });
  const unmanaged = unmanagedWebhooks(address, live).filter((w) => !(action.kind === "update-address" && w.id === action.id));
  const others = unmanaged.length;
  if (action.kind === "ok") note(`webhooks: ok (${address} is enabled)`);
  else {
    changes++;
    if (action.kind === "create") note(`webhooks: + create ${address}`);
    if (action.kind === "enable") note(`webhooks: ~ enable the webhook at ${address}`);
    if (action.kind === "update-address") note(`webhooks: ~ move the webhook from ${action.from} to ${address} (keeps its secret)`);
  }
  if (others > 0) {
    note(`webhooks: ${others} other webhook(s) in this environment are not managed here and are left alone:`);
    for (const w of unmanaged) note(`  ${describeAddress(w.address)} (${w.enabled ? "enabled" : "disabled"})`);
    if (action.kind === "create" && others === 1 && !dev) {
      note("  If that is this app's webhook at another address, do not push (a second webhook would double every delivery): run `diff --adopt` to see it moved to the address above, keeping its signing secret.");
    }
  }
  if (!push || action.kind === "ok") return;

  if (action.kind === "enable") await mux(systemAuth, "PATCH", `/system/v1/webhooks/${action.id}`, { enabled: true });
  else if (action.kind === "update-address") await mux(systemAuth, "PATCH", `/system/v1/webhooks/${action.id}`, { address });
  else {
    const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    if (envValue(current, "MUX_WEBHOOK_SECRET") && !replaceSecret) {
      fail(`${envFile} already has a MUX_WEBHOOK_SECRET. A new webhook has a new secret, which would replace it. Re-run with --replace-secret if that is what you want.`);
    }
    const created = await mux<{ signing_secret: string }>(systemAuth, "POST", "/system/v1/webhooks", { address });
    if (!created.data?.signing_secret) fail("Mux created the webhook but returned no signing secret; delete it in the dashboard and retry");
    writeFileSync(envFile, setEnvValue(current, "MUX_WEBHOOK_SECRET", created.data.signing_secret));
    note(`webhooks: created. Its signing secret was saved to MUX_WEBHOOK_SECRET in ${envFile} (not printed; Mux will not show it again).`);
    note(dev ? "  Restart pnpm dev to pick it up." : "  Next: pnpm env:sync --only=MUX_WEBHOOK_SECRET");
  }
}

async function restrictions() {
  // Playback restrictions are part of Mux Video, which the app token has; the System token (webhooks) does not.
  const auth = appAuth ?? systemAuth;
  if (!auth) fail("MUX_TOKEN_ID / MUX_TOKEN_SECRET are not set");
  const live = await listAll<LiveRestriction>(auth, "/video/v1/playback-restrictions");
  if (!live) fail("the token was refused for playback restrictions (it needs Mux Video access)");
  const action = planRestriction(config.restriction, live);
  const want = config.restriction;
  if (action.kind === "ok") note(`playback restriction: ok (${want.allowedDomains.length} domains, no-referrer ${want.allowNoReferrer ? "allowed" : "denied"})`);
  else if (action.kind === "ambiguous") {
    note(`playback restriction: ${action.count} exist and none can be told apart as ours; nothing is changed. Delete the extras in the dashboard.`);
    changes++;
    return;
  } else {
    changes++;
    note(`playback restriction: ${action.kind === "create" ? "+ create" : "~ update"} -> domains [${want.allowedDomains.join(", ")}], no-referrer ${want.allowNoReferrer ? "allowed" : "denied"}`);
    if (action.kind === "update") note(`  was: [${live[0].referrer.allowed_domains.join(", ")}], no-referrer ${live[0].referrer.allow_no_referrer ? "allowed" : "denied"}`);
  }
  if (!push || action.kind === "ok") return;
  if (action.kind === "create") {
    const created = await mux<{ id: string }>(auth, "POST", "/video/v1/playback-restrictions", { referrer: restrictionBody(want) });
    note(`playback restriction: created (id ${created.data?.id}). Tokens only honor it when they carry this id as playback_restriction_id.`);
  } else {
    await mux(auth, "PUT", `/video/v1/playback-restrictions/${action.id}/referrer`, restrictionBody(want));
    note("playback restriction: updated");
  }
}

async function main() {
  note(`${push ? "Pushing" : "Diffing"} mux-config.yml against ${dev ? "your dev" : "the production"} Mux environment`);
  await webhooks();
  if (!dev) await restrictions();
  note(changes === 0 ? "✓ nothing to change" : push ? `✓ applied ${changes} change(s)` : `${changes} change(s) pending; run mux:config:push to apply`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
