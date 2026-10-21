// pnpm tunnel [<port>]: a public https address for your local dev server, so a vendor can
// send webhooks to it. One command instead of each vendor's own forwarding. See
// scripts/tunnel-command.ts and docs/WEBHOOK_SETUP.md.

import { spawn, spawnSync } from "node:child_process";
import { planTunnel, TUNNEL_USAGE } from "./tunnel-command";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(TUNNEL_USAGE);
  process.exit(0);
}

const ngrokInstalled = spawnSync("which", ["ngrok"], { stdio: "ignore" }).status === 0;

const plan = planTunnel(ngrokInstalled, argv, process.env.TUNNEL_DOMAIN || undefined);
if (!plan.ok) {
  console.error(`✗ ${plan.error}`);
  process.exit(1);
}

const { tool, args } = plan.command;
console.log(`Starting ${tool}. Paste the https address it prints into the vendor's webhook settings.\n`);
const child = spawn(tool, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
