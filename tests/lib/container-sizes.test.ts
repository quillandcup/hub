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

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

describe("container query sizes", () => {
  it("defines the named sizes", () => {
    expect(sizes).toEqual(["pair", "cards", "split", "columns", "outline"]);
  });

  it("are the only sizes used in app and components", () => {
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    for (const file of ["app", "components"].flatMap((dir) => sourceFiles(path.join(root, dir)))) {
      const text = fs.readFileSync(file, "utf8");
      // `@container` (no colon) is the wrapper; `@name:` is a variant. Anything not named is an offender.
      for (const match of text.matchAll(/(?<![\w-])@([\w[\].-]+):/g)) {
        if (!sizes.includes(match[1])) offenders.push(`${path.relative(root, file)}: @${match[1]}:`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
