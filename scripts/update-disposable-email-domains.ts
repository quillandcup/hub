/**
 * Refreshes lib/disposable-email-domains.generated.ts from the public blocklist
 * (https://github.com/disposable-email-domains/disposable-email-domains, CC0).
 * Run `pnpm disposable-domains:update`, review the diff and open a PR.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlocklist, renderDomainsModule } from "../lib/disposable-email";

const SOURCE = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const MIN_EXPECTED = 5000;

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Fetching the blocklist failed: ${res.status}`);
  const domains = parseBlocklist(await res.text());
  if (domains.length < MIN_EXPECTED) throw new Error(`Only ${domains.length} domains came back; refusing to overwrite the list`);
  const target = join(__dirname, "..", "lib", "disposable-email-domains.generated.ts");
  writeFileSync(target, renderDomainsModule(domains, SOURCE, new Date().toISOString().slice(0, 10)));
  console.log(`Wrote ${domains.length} domains to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
