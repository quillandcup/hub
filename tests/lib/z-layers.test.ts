import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "@/config/tailwind";

/**
 * Stacking order is named in config/tailwind.ts (`z-dropdown`, `z-overlay`...), never a number. Picking
 * `z-30` in one component and `z-40` in another leaves nobody able to say which of two things wins; a
 * numeric class compiles fine, so nothing else would catch one. `z-auto` and `z-0` are not layers.
 */
const layers = Object.keys(((config.theme as { extend?: { zIndex?: Record<string, string> } }).extend ?? {}).zIndex ?? {});

const root = path.resolve(__dirname, "../..");
const dirs = ["src/app", "src/components", "src/lib", "src/emails"];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

describe("z-index layers", () => {
  it("defines the layers lowest to highest", () => {
    const values = Object.values(((config.theme as { extend?: { zIndex?: Record<string, string> } }).extend ?? {}).zIndex ?? {}).map(Number);
    expect(layers).toEqual(["raised", "float", "sticky", "dropdown", "rail", "shell", "rail-open", "overlay", "overlay-top"]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("are the only z-index classes used in the app", () => {
    const offenders: string[] = [];
    for (const file of dirs.flatMap((d) => sourceFiles(path.join(root, d)))) {
      const text = fs.readFileSync(file, "utf8");
      // A utility is `z-<n>` or `z-[<n>]`, with any variant prefix (`sm:`, `has-[...]:`); `-z-10` too.
      for (const match of text.matchAll(/(?<![\w-])-?z-(\d+|\[[^\]]+\])(?![\w-])/g)) {
        offenders.push(`${path.relative(root, file)}: z-${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
