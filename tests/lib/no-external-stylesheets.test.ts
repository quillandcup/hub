// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `@puckeditor/core/puck.css` begins with `@import "https://rsms.me/inter/inter.css"`, a request to a font site on every
// editor load that the Content-Security-Policy refuses (Sentry HUB-1R, HUB-1S: ~800 blocked font loads in a week). Its
// `no-external.css` is the same stylesheet without the import.

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(path);
  }
  return out;
}

describe("stylesheets that fetch from another site", () => {
  it("the app imports Puck's no-external stylesheet, never puck.css", () => {
    const offenders = ["src/app", "src/components"]
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => /@puckeditor\/core\/(puck\.css|dist\/index\.css)/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(`${ROOT}/`, ""));
    expect(offenders).toEqual([]);
  });

  it("Puck's no-external stylesheet imports nothing from another site", () => {
    const css = readFileSync(join(ROOT, "node_modules/@puckeditor/core/dist/no-external.css"), "utf8");
    expect(css).not.toMatch(/@import\s+(url\()?["']?https?:/);
  });

  it("no app stylesheet imports another site", () => {
    const offenders = ["src/app", "src/components"]
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => file.endsWith(".css") && /@import\s+(url\()?["']?https?:/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(`${ROOT}/`, ""));
    expect(offenders).toEqual([]);
  });
});
