// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// A client component must not reach a module that imports a Node built-in (crypto, vm, stream...): the bundler then ships
// browser copies of them, and the `vm` one calls eval(), which a Content-Security-Policy without 'unsafe-eval' blocks
// (Sentry HUB-1E; docs/TODO.md, "CSP for scripts and styles (nonces)"). Keep browser code on small client-safe modules
// (lib/chat/channels.ts is the pattern) and leave the Node-only work to server modules.

const ROOT = process.cwd();
const BUILTIN = /^(node:)?(crypto|vm|stream|zlib|buffer|fs|path|child_process|os|net|tls|http|https|util)$/;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT = /(?:import|export)\s+(?!type\b)[^"';]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const cache = new Map<string, string>();
const read = (file: string): string => {
  if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
  return cache.get(file)!;
};

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of EXTENSIONS) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}

const isClient = (file: string) => /^\s*["']use client["']/.test(read(file));
const isServerOnly = (file: string) => /^\s*["']use server["']/.test(read(file)) || /import\s+["']server-only["']/.test(read(file));

/** Every client entry point that can reach a Node built-in, with the first chain that does. */
export function clientEntriesReachingBuiltins(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const entry of files.filter(isClient)) {
    const seen = new Set([entry]);
    const stack: Array<[string, string[]]> = [[entry, [entry]]];
    while (stack.length && !found.has(entry)) {
      const [file, path] = stack.pop()!;
      for (const match of read(file).matchAll(IMPORT)) {
        const spec = (match[1] || match[2] || match[3])!;
        if (BUILTIN.test(spec)) {
          found.set(entry, [...path, spec]);
          break;
        }
        const next = resolveImport(file, spec);
        if (next && !seen.has(next) && !isServerOnly(next)) {
          seen.add(next);
          stack.push([next, [...path, next]]);
        }
      }
    }
  }
  return found;
}

describe("client components and Node built-ins", () => {
  const rel = (path: string) => path.replace(`${ROOT}/`, "");

  it("no client component reaches a module that imports a Node built-in", () => {
    const files = ["app", "components", "lib"].flatMap((dir) => walk(join(ROOT, dir)));
    const chains = [...clientEntriesReachingBuiltins(files).values()].map((chain) => chain.map(rel).join(" > "));
    expect(chains).toEqual([]);
  });

  describe("the detector", () => {
    const dir = mkdtempSync(join(tmpdir(), "client-builtins-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const write = (name: string, body: string) => {
      const path = join(dir, name);
      writeFileSync(path, body);
      return path;
    };

    it("follows relative imports from a client file to a built-in", () => {
      write("deep.ts", 'import { randomInt } from "node:crypto";\nexport const x = randomInt(3);\n');
      write("mid.ts", 'import { x } from "./deep";\nexport const y = x;\n');
      const client = write("client.tsx", '"use client";\nimport { y } from "./mid";\nexport const C = () => y;\n');
      const found = clientEntriesReachingBuiltins([client]);
      expect([...found.values()][0]?.map((p) => p.split("/").pop())).toEqual(["client.tsx", "mid.ts", "deep.ts", "node:crypto"]);
    });

    it("ignores type-only imports, server-only modules and server files", () => {
      write("types.ts", 'import { randomInt } from "node:crypto";\nexport type T = number;\n');
      write("secret.ts", 'import "server-only";\nimport { randomInt } from "node:crypto";\nexport const s = randomInt(3);\n');
      const client = write("safe.tsx", '"use client";\nimport type { T } from "./types";\nimport { s } from "./secret";\nexport const C = (): T => s;\n');
      expect(clientEntriesReachingBuiltins([client]).size).toBe(0);
    });

    it("does not start from a file that is not a client component", () => {
      const server = write("server.ts", 'import { randomInt } from "node:crypto";\nexport const n = randomInt(3);\n');
      expect(clientEntriesReachingBuiltins([server]).size).toBe(0);
    });
  });
});
