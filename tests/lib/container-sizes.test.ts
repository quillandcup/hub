import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "@/tailwind.config";

/**
 * Container-query variants use the named sizes in tailwind.config.ts (`@split:`, `@outline:`...), so
 * every page reflows at the same widths and shell-derived thresholds live in one place. The
 * plugin's own sizes (`@md:`, `@3xl:`) and `@[62rem]:` literals still compile, which is why this
 * test exists: nothing else would catch one.
 */
const sizes = Object.keys(((config.theme as { extend?: { containers?: Record<string, string> } }).extend ?? {}).containers ?? {});

const root = path.resolve(__dirname, "../..");
const skippedDirs = new Set(["node_modules", ".next", ".next-demo", ".git", ".vercel", "coverage", "playwright-report", "test-results"]);
const thisFile = path.join(root, "tests/lib/container-sizes.test.ts");

/** Every code file in the repo (not just app and components: emails, lib, scripts, tests...), so a class can't hide elsewhere. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skippedDirs.has(entry.name) ? [] : sourceFiles(full);
    return /\.(tsx?|jsx?|mjs|cjs|css|html)$/.test(entry.name) && full !== thisFile ? [full] : [];
  });
}

describe("container query sizes", () => {
  it("defines the named sizes", () => {
    expect(sizes).toEqual(["pair", "cards", "split", "columns", "outline"]);
  });

  it("are the only sizes used anywhere in the repo", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = fs.readFileSync(file, "utf8");
      // `@container` (no colon) is the wrapper; `@name:` is a variant. Anything not named is an offender.
      for (const match of text.matchAll(/(?<![\w-])@([\w[\].-]+):/g)) {
        if (!sizes.includes(match[1])) offenders.push(`${path.relative(root, file)}: @${match[1]}:`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
