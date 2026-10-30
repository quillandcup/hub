import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * A "use client" file is bundled for the browser, so a value import (not `import type`) of a module that pulls in the
 * server-side repositories takes the page down with a client-side exception at runtime, which a build and the
 * component tests (which run in Node) don't notice. This is how the past events page broke.
 */
const SERVER_ONLY_MODULES = ["@/lib/event-prickles", "@/lib/data/repos", "@/lib/data/server", "@/lib/supabase/server", "@/lib/supabase/service"];

const ROOT = path.resolve(__dirname, "../..");

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe("client components", () => {
  it("do not import server-side modules as values", () => {
    const offenders: string[] = [];
    for (const file of [...sources("app"), ...sources("components")]) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (!/^\s*["']use client["']/.test(text)) continue;
      for (const [, imported] of text.matchAll(/^import\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gm)) {
        if (SERVER_ONLY_MODULES.includes(imported)) offenders.push(`${file} imports ${imported}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches the import that broke the past events page", () => {
    const text = 'import { withoutFollowedEvents, type EventPrickle } from "@/lib/event-prickles";\nimport type { Db } from "@/lib/data/repos";';
    const found = [...text.matchAll(/^import\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(found).toEqual(["@/lib/event-prickles"]);
  });

  /**
   * The other direction: a server file (page, layout, route, lib) that imports a *function* from a "use client" file
   * gets a client reference instead, and calling it on the server fails with React error #441, shown to the person
   * as "a client-side exception". Components (PascalCase) and types are what a client file is for; a helper
   * belongs in a plain module next to it. This is how the past events page broke a second time.
   */
  it("are not called from server files: only components and types are imported from them", () => {
    const isClientFile = (file: string) => /^\s*["']use client["']/.test(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.join(path.dirname(from), spec) : null;
      if (!base) return null;
      return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((ext) => base + ext).find((f) => fs.existsSync(path.join(ROOT, f))) ?? null;
    };
    const offenders: string[] = [];
    for (const file of [...sources("app"), ...sources("lib"), ...sources("components")]) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (isClientFile(file)) continue;
      for (const [, names, spec] of text.matchAll(/^import\s+(?!type\b)[^{;]*\{([^}]*)\}\s*from\s+["']([^"']+)["']/gm)) {
        const target = resolve(file, spec);
        if (!target || !isClientFile(target)) continue;
        for (const name of names.split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "))) {
          const local = name.split(/\s+as\s+/)[0];
          if (/^[a-z]/.test(local)) offenders.push(`${file} imports the function ${local} from the client file ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
