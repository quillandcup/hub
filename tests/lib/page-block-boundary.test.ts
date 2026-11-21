import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

/**
 * The boundary between the pages code (src/lib/landing, src/components/landing) and the modules that contribute to it
 * (src/modules/<name>): the pages code never imports events code or a module's internals, and a module's internals are named only by the
 * composition root. It is enforced twice: by the lint rule in config/eslint.mjs (checked here against sample imports, so the rule can't be
 * loosened unnoticed) and by reading the real files' imports.
 */

const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "config/eslint.mjs") });
const violations = async (filePath: string, source: string) => (await eslint.lintText(source, { filePath: path.join(ROOT, filePath) }))[0].messages.filter((m) => m.ruleId === "no-restricted-imports");

describe("the lint rule", () => {
  it.each([
    ["src/lib/landing/x.ts", "@/lib/events-agenda"],
    ["src/lib/landing/x.ts", "@/lib/events-filter"],
    ["src/lib/landing/x.ts", "@/lib/event-signup"],
    ["src/lib/landing/x.ts", "@/lib/data/events"],
    ["src/components/landing/X.tsx", "@/components/EventArt"],
    ["src/components/landing/X.tsx", "@/modules/events/page-blocks"],
    ["src/components/landing/X.tsx", "@/modules/events/page-blocks/blocks"],
    ["src/lib/landing/x.ts", "@/modules/events/page-blocks/live-events"],
    ["src/app/p/[slug]/x.ts", "@/modules/events/page-blocks/live-events"],
    ["src/lib/x.ts", "@/modules/events/page-blocks/blocks"],
  ])("fails %s importing %s", async (file, from) => {
    const found = await violations(file, `import { x } from "${from}";\nexport const y = x;\n`);
    expect(found, `${file} -> ${from}`).toHaveLength(1);
  });

  it.each([
    ["src/lib/landing/x.ts", "@/modules/server"],
    ["src/components/landing/X.tsx", "@/modules"],
    ["src/components/landing/editor-config.tsx", "@/modules/editor"],
    ["src/lib/landing/x.ts", "@/lib/config"],
    ["src/app/(member)/events/page.tsx", "@/lib/events-agenda"],
    ["src/modules/events/page-blocks/blocks.tsx", "@/lib/events-filter"],
    ["src/modules/index.ts", "./events/page-blocks"],
  ])("lets %s import %s", async (file, from) => {
    expect(await violations(file, `import { x } from "${from}";\nexport const y = x;\n`)).toHaveLength(0);
  });
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? sourceFiles(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });

const importsOf = (file: string) => [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("the pages code's imports", () => {
  const pages = [...sourceFiles("src/lib/landing"), ...sourceFiles("src/components/landing")];

  it("finds the pages code", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it("never reach into events code or a module's internals", () => {
    const banned = /^@\/(lib\/events-|lib\/event-|lib\/events\/|lib\/calendar-|lib\/data\/events$|components\/EventArt$|app\/.*\/events\/)|^@\/modules\/(?!(index|editor|server)$).+/;
    const found = pages.flatMap((file) => importsOf(file).filter((spec) => banned.test(spec)).map((spec) => `${file} imports ${spec}`));
    expect(found).toEqual([]);
  });

  it("do not use relative paths to get around it", () => {
    const found = pages.flatMap((file) => importsOf(file).filter((spec) => spec.startsWith(".") && /modules|events/.test(spec)).map((spec) => `${file} imports ${spec}`));
    expect(found).toEqual([]);
  });
});

describe("the modules", () => {
  it("are imported by the composition root alone, outside their own folder", () => {
    const outside = [...sourceFiles("src"), ...sourceFiles("scripts")].filter((f) => !f.startsWith("src/modules/"));
    const found = outside.flatMap((file) => importsOf(file).filter((spec) => /^@\/modules\/(?!(index|editor|server)$)/.test(spec)).map((spec) => `${file} imports ${spec}`));
    expect(found).toEqual([]);
  });
});
