// Checks what the public site's root host answers for a list of old Kajabi, Hub and public URLs, without following redirects.
// Run it after the cutover (and against a deployment before it): it exits non-zero when any URL answers differently than expected.
//
//   pnpm check:redirects                         the public site (config/app.ts siteUrl) and scripts/data/redirect-check-urls.txt
//   pnpm check:redirects https://<some-host>     another base URL; add --host quillandcup.com to send that Host header
//   pnpm check:redirects --file other-list.txt   another list (format: the top of scripts/data/redirect-check-urls.txt)
//
// Read-only: it only sends GET requests. The expected outcomes come from the config (src/lib/config.ts), see scripts/root-redirect-check.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { outboundHeaders } from "../src/lib/http/outbound";
import { expectedFor, formatTable, parseArgs, parseUrlList, rowOk, type Row } from "./root-redirect-check";

/** One GET without following redirects. node:http rather than fetch, because fetch cannot send a Host header of its own. */
function get(url: string, host: string | null): Promise<{ status: number; location: string | null }> {
  const client = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { headers: outboundHeaders(host ? { host } : {}) }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === "string" ? res.headers.location : null });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timed out")));
  });
}

async function main() {
  const { base, file, host } = parseArgs(process.argv.slice(2), path.join(__dirname, "data/redirect-check-urls.txt"));
  const rows: Row[] = [];
  for (const entry of parseUrlList(readFileSync(file, "utf8"))) {
    const expected = expectedFor(entry);
    try {
      rows.push({ path: entry.path, expected, actual: await get(`${base}${entry.path}`, host) });
    } catch (error) {
      rows.push({ path: entry.path, expected, actual: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  console.log(formatTable(rows));
  if (!rows.every(rowOk)) process.exit(1);
}

void main();
