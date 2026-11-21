import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Two things that used to be dotfiles at the root now live elsewhere:
// - the git hooks are plain executable scripts in config/husky/, and `pnpm install` points core.hooksPath at them;
// - the Node version is `engines.node` in package.json, which CI (`node-version-file`) and Vercel both read.
// core.hooksPath is shared by every worktree of the clone, so a hook that is not executable or has no shebang would be
// skipped or fail in all of them: these tests keep the files in the shape git needs.
const ROOT = path.resolve(__dirname, "../..");
const HOOKS = ["pre-commit", "pre-push"];

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
};

describe("git hooks in config/husky", () => {
  it.each(HOOKS)("%s is an executable script with a shebang", (name) => {
    const file = path.join(ROOT, "config", "husky", name);
    expect(readFileSync(file, "utf8").startsWith("#!/usr/bin/env sh\n"), `${name} needs a shebang, git runs it directly`).toBe(true);
    expect(statSync(file).mode & 0o111, `${name} must be executable`).not.toBe(0);
  });

  it("puts node_modules/.bin on the path, since git no longer runs the hooks through husky", () => {
    for (const name of HOOKS) {
      expect(readFileSync(path.join(ROOT, "config", "husky", name), "utf8")).toContain('export PATH="node_modules/.bin:$PATH"');
    }
  });

  it("is what `pnpm install` points git at, and husky itself is gone", () => {
    expect(pkg.scripts.prepare).toContain("git config core.hooksPath config/husky");
    expect(pkg.devDependencies?.husky).toBeUndefined();
  });

  it("has only the hook scripts in the folder", () => {
    const names = readdirSync(path.join(ROOT, "config", "husky")).filter((f) => !f.startsWith("_") && !f.startsWith("."));
    expect(names.sort()).toEqual([...HOOKS].sort());
  });
});

describe("the Node version", () => {
  it("is engines.node in package.json, a major version line", () => {
    expect(pkg.engines?.node).toMatch(/^\d+\.x$/);
  });

  it("is what every workflow reads, and there is no .nvmrc", () => {
    const dir = path.join(ROOT, ".github", "workflows");
    const lines: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
      for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) {
        if (line.includes("node-version-file")) lines.push(`${f}: ${line.trim()}`);
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => !l.endsWith('node-version-file: "package.json"'))).toEqual([]);
    expect(() => statSync(path.join(ROOT, ".nvmrc"))).toThrow();
  });
});
