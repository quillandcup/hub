// Checks the licenses of the installed dependencies against config/license-policy.json.
//
//   pnpm check:licenses        exits 1 when a package has a license the policy does not allow
//
// It reads `pnpm licenses list --json` (needs `pnpm install` first), once for the production
// dependencies and once for all of them; a package only in the second list is development-only.
// Run by .github/workflows/license-scan.yml (informational, never a required check).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type LicenseException = { package: string; license: string; expires: string; reason: string };
export type LicensePolicy = {
  allowedProduction: string[];
  allowedDevelopmentOnly: string[];
  exceptions: LicenseException[];
};
export type InstalledPackage = { name: string; version: string; license: string; production: boolean };
export type Finding = { name: string; version: string; license: string; production: boolean; kind: string; note?: string };

/** An SPDX expression is fine when an OR has an allowed side and every AND side is allowed; `WITH` exceptions are ignored. */
export function expressionAllowed(expression: string, allowed: ReadonlySet<string>): boolean {
  const text = expression.replace(/[()]/g, " ").replace(/\s+WITH\s+\S+/g, "");
  return text.split(/\s+OR\s+/).some((alternative) =>
    alternative.split(/\s+AND\s+/).every((id) => allowed.has(id.trim())),
  );
}

export function classify(license: string): string {
  if (/^(unknown|unlicensed|none|see license.*)$/i.test(license.trim())) return "no license declared";
  if (/\b(AGPL|GPL|SSPL|EUPL|OSL|CPAL)/i.test(license) && !/LGPL/i.test(license)) return "strong copyleft";
  if (/LGPL|MPL|EPL|CDDL/i.test(license)) return "weak copyleft";
  return "not on the allow-list";
}

function matches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

export function findException(policy: LicensePolicy, pkg: InstalledPackage): LicenseException | undefined {
  return policy.exceptions.find((e) => matches(e.package, pkg.name) && e.license === pkg.license);
}

export function checkLicenses(policy: LicensePolicy, packages: InstalledPackage[], today: string) {
  const prodAllowed = new Set(policy.allowedProduction);
  const devAllowed = new Set([...policy.allowedProduction, ...policy.allowedDevelopmentOnly]);
  const findings: Finding[] = [];
  const accepted: Array<InstalledPackage & { exception: LicenseException }> = [];
  for (const pkg of packages) {
    if (expressionAllowed(pkg.license, pkg.production ? prodAllowed : devAllowed)) continue;
    const exception = findException(policy, pkg);
    if (exception && exception.expires >= today) {
      accepted.push({ ...pkg, exception });
      continue;
    }
    findings.push({
      ...pkg,
      kind: classify(pkg.license),
      note: exception ? `exception expired ${exception.expires}` : undefined,
    });
  }
  const unused = policy.exceptions.filter((e) => !packages.some((p) => matches(e.package, p.name) && p.license === e.license));
  return { findings, accepted, unused };
}

type PnpmLicenses = Record<string, Array<{ name: string; versions: string[] }>>;

function listLicenses(args: string[]): InstalledPackage[] {
  const output = execFileSync("pnpm", ["licenses", "list", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const parsed = JSON.parse(output) as PnpmLicenses;
  return Object.entries(parsed).flatMap(([license, entries]) =>
    entries.flatMap((entry) => entry.versions.map((version) => ({ name: entry.name, version, license, production: false }))),
  );
}

function main() {
  const policy = JSON.parse(readFileSync("config/license-policy.json", "utf8")) as LicensePolicy;
  const production = listLicenses(["--prod"]);
  const productionKeys = new Set(production.map((p) => `${p.name}@${p.version}`));
  const packages = listLicenses([]).map((p) => ({ ...p, production: productionKeys.has(`${p.name}@${p.version}`) }));
  const today = new Date().toISOString().slice(0, 10);
  const { findings, accepted, unused } = checkLicenses(policy, packages, today);

  const prodCount = packages.filter((p) => p.production).length;
  console.log(`license-scan: ${packages.length} packages (${prodCount} production, ${packages.length - prodCount} development only).`);
  console.log(`license-scan: ${accepted.length} accepted by an exception, ${findings.length} finding(s).`);
  for (const f of findings) {
    console.log(`  FINDING [${f.production ? "production" : "development"}] ${f.name}@${f.version}: ${f.license} (${f.kind})${f.note ? `, ${f.note}` : ""}`);
  }
  for (const e of unused) console.log(`  note: exception for ${e.package} (${e.license}) matched nothing; remove it if it is no longer needed.`);
  process.exitCode = findings.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith("check-licenses.ts")) main();
