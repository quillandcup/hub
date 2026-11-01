import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Supabase client the app builds is typed with the generated `Database`
 * (lib/data/database.types.ts), so a misspelled column, a nullable value passed where the table
 * says NOT NULL, or an RPC that no migration creates fails `pnpm typecheck` instead of failing in
 * production. An untyped client (`SupabaseClient<any>`) hides all of that, and a union of typed and
 * untyped clients breaks every query on it, so a client is created typed or not at all.
 */
const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// Files that call a client factory from the Supabase packages (not just import its types).
const FACTORY_CALL = /\b(createClient|createServerClient|createBrowserClient|createServiceClient|createDirectClient)\s*(<[^>(]*>)?\(/g;
const IMPORTS_FACTORY = /import\s*\{[^}]*\b(createClient|createServerClient|createBrowserClient)\b[^}]*\}\s*from\s*["']@supabase\/(supabase-js|ssr)["']/;

describe("Supabase clients are typed", () => {
  const files = ["app", "lib", "components"]
    .flatMap((dir) => sourceFiles(path.join(root, dir)))
    .map((file) => ({ file: path.relative(root, file), source: fs.readFileSync(file, "utf8") }))
    .filter(({ source }) => IMPORTS_FACTORY.test(source));

  it("finds the files that build clients", () => {
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining(["lib/supabase/server.ts", "lib/supabase/service.ts", "lib/supabase/client.ts"]));
  });

  it("passes the generated Database type to every client it creates", () => {
    const untyped = files.flatMap(({ file, source }) =>
      [...source.matchAll(FACTORY_CALL)]
        // `createClient()` with no arguments is our own wrapper (lib/supabase/server.ts), not a Supabase factory.
        .filter((m) => !(m[0].endsWith("()") && !source.includes(`import { ${m[1]} }`)))
        .filter((m) => !m[2] && /\(\s*[^)\s]/.test(source.slice(m.index!, m.index! + m[0].length + 40)))
        .map(() => file),
    );

    expect([...new Set(untyped)], "create these clients with <Database> (import type { Database } from \"@/lib/data/database.types\")").toEqual([]);
  });
});
