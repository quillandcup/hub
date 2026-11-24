#!/usr/bin/env npx tsx
// Builds the OpenVEX document (config/vex.openvex.json) from the findings we accept on purpose in config/osv-scanner.toml.
// The toml stays the single source of truth; the VEX file is generated from it and never edited by hand.
//
//   tsx scripts/vex.ts          write config/vex.openvex.json   (pnpm vex)
//   tsx scripts/vex.ts --check  exit 1 if the committed file is out of date (tests/lib/vex.test.ts runs the same check)
//
// Spec: https://github.com/openvex/spec (v0.2.0). The product is the application built from this repository, named by
// the purl pkg:github/<owner>/<name> (appConfig.repository). Each entry's status comes from its `reason`:
//   - "not in the production build"  -> not_affected, justification component_not_present (the vulnerable package is a
//     development-only dependency, so it is not a component of what we deploy). Reachability from the dev tool is not claimed.
//   - "no fix published"             -> affected, with an action statement (the finding is real and has no patch yet).
// A reason that says neither makes the script fail, so a new entry has to say which it is. Timestamps and `version` only
// move when an entry changes, so the file stays the same between runs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appConfig from "../config/app";

export const VEX_CONTEXT = "https://openvex.dev/ns/v0.2.0";
export const VEX_PATH = "config/vex.openvex.json";
export const OSV_SCANNER_PATH = "config/osv-scanner.toml";

export interface AcceptedFinding {
  id: string;
  effectiveUntil: string;
  reason: string;
}

export interface VexStatement {
  vulnerability: { "@id": string; name: string };
  products: { "@id": string; identifiers: { purl: string } }[];
  status: "not_affected" | "affected" | "under_investigation" | "fixed";
  justification?: string;
  impact_statement?: string;
  action_statement?: string;
  status_notes: string;
  timestamp: string;
}

export interface VexDocument {
  "@context": string;
  "@id": string;
  author: string;
  role: string;
  timestamp: string;
  last_updated: string;
  version: number;
  tooling: string;
  statements: VexStatement[];
}

/** Reads the `[[IgnoredVulns]]` tables of config/osv-scanner.toml. Anything else in the file is an error: extend this first. */
export function parseAcceptedFindings(toml: string): AcceptedFinding[] {
  const found: Record<string, string>[] = [];
  for (const [i, raw] of toml.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[IgnoredVulns]]") {
      found.push({});
      continue;
    }
    const kv = /^(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(\d{4}-\d{2}-\d{2}))\s*(?:#.*)?$/.exec(line);
    if (!kv || found.length === 0) throw new Error(`${OSV_SCANNER_PATH} line ${i + 1}: cannot read "${line}"`);
    found[found.length - 1][kv[1]] = kv[2] ?? kv[3];
  }
  return found.map((f, n) => {
    for (const key of ["id", "effectiveUntil", "reason"]) {
      if (!f[key]) throw new Error(`${OSV_SCANNER_PATH}: IgnoredVulns entry ${n + 1} has no ${key}`);
    }
    return { id: f.id, effectiveUntil: f.effectiveUntil, reason: f.reason.replace(/\\"/g, '"') };
  });
}

export function productPurl(): string {
  return `pkg:github/${appConfig.repository.owner}/${appConfig.repository.name}`;
}

/** The statement for one accepted finding, without its timestamp. Throws when the reason supports no status. */
export function statementFor(f: AcceptedFinding): Omit<VexStatement, "timestamp"> {
  const base = {
    vulnerability: { "@id": `https://osv.dev/vulnerability/${f.id}`, name: f.id },
    products: [{ "@id": productPurl(), identifiers: { purl: productPurl() } }],
    status_notes: `Accepted until ${f.effectiveUntil} (${OSV_SCANNER_PATH}); it fails the weekly scan again then. Reason recorded: ${f.reason}`,
  };
  const reason = f.reason.toLowerCase();
  if (reason.includes("not in the production build")) {
    return {
      ...base,
      status: "not_affected",
      justification: "component_not_present",
      impact_statement: `The affected package is a development-only dependency and is not part of the production build. ${f.reason}`,
    };
  }
  if (reason.includes("no fix published")) {
    return {
      ...base,
      status: "affected",
      action_statement: `No fixed version is published. Tracked in ${OSV_SCANNER_PATH} with an expiry date; revisit when a fix appears. ${f.reason}`,
    };
  }
  throw new Error(`${f.id}: the reason supports no VEX status. Say "not in the production build" or "no fix published" in it.`);
}

const withoutTime = (s: object) => JSON.stringify({ ...s, timestamp: "" });

/** The document for these findings. Timestamps and version come from `previous` for whatever has not changed. */
export function buildVex(findings: AcceptedFinding[], previous: VexDocument | null, now: Date): VexDocument {
  const stamp = now.toISOString();
  const statements = findings.map((f) => {
    const s = statementFor(f);
    const old = previous?.statements.find((p) => p.vulnerability.name === f.id);
    const same = old && withoutTime(old) === withoutTime(s);
    return { ...s, timestamp: same ? old.timestamp : stamp } as VexStatement;
  });
  const { owner, name } = appConfig.repository;
  const doc: VexDocument = {
    "@context": VEX_CONTEXT,
    "@id": `https://github.com/${owner}/${name}/blob/main/${VEX_PATH}`,
    author: `${owner}/${name} maintainers`,
    role: "Maintainers",
    timestamp: previous?.timestamp ?? stamp,
    last_updated: stamp,
    version: 1,
    tooling: `${owner}/${name} scripts/vex.ts`,
    statements,
  };
  const strip = (d: VexDocument) => JSON.stringify({ ...d, last_updated: "", version: 0 });
  if (previous && strip(doc) === strip(previous)) return previous;
  doc.version = previous ? previous.version + 1 : 1;
  return doc;
}

export function renderVex(doc: VexDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readPrevious(root = ROOT): VexDocument | null {
  const file = path.join(root, VEX_PATH);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as VexDocument) : null;
}

export function generate(root = ROOT, now = new Date()): string {
  const findings = parseAcceptedFindings(readFileSync(path.join(root, OSV_SCANNER_PATH), "utf8"));
  return renderVex(buildVex(findings, readPrevious(root), now));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = generate();
  const file = path.join(ROOT, VEX_PATH);
  if (process.argv.includes("--check")) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== out) {
      console.error(`${VEX_PATH} is out of date: run pnpm vex`);
      process.exit(1);
    }
  } else {
    writeFileSync(file, out);
    console.log(`Wrote ${VEX_PATH}`);
  }
}
