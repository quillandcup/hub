/**
 * The client/server import boundary, judged from a set of source files (path -> text), so the same code checks the real
 * app and the small fixtures that prove it catches what it should.
 *
 * 1. A "use client" file is bundled for the browser, so nothing it imports as a value, however many files down, may be
 *    server-only (`next/headers`, `server-only`, `fs`, ...). A "use server" file is where that stops: the client gets a
 *    reference to call, not its code.
 * 2. A server file that imports from a "use client" file gets client references, which can be rendered but not called
 *    or read: only components (PascalCase) may be imported, never a function, a constant or a namespace. Calling one
 *    fails the server render with React error #441, which the person sees as "a client-side exception".
 *
 * A file the client bundles (reachable from a "use client" file) is exempt from 2: it is client code without the
 * directive. Type imports are erased and never count.
 */
import path from "node:path";

export type Files = Map<string, string>;

/** What a browser can't load: a file that imports one of these is server-only, and so is any client file that pulls it in. */
// (Not `crypto`, `path`, `os`, `stream`, `zlib` or `http(s)`: Next polyfills those for the browser, so they load there.)
const SERVER_ONLY_PACKAGES = /^(server-only|next\/headers|node:fs|node:child_process|node:net|node:tls|node:dns|fs|child_process|net|tls|dns|web-push|googleapis|resend|@react-email\/render|@slack\/web-api|stripe|sharp|heic-convert|sanitize-html|turndown)$/;

export interface ImportOf {
  spec: string;
  /** What is imported as a value: "default", "*" for a namespace or `export *`, or a named export. Empty for a side-effect or dynamic import. */
  names: string[];
  /** The local name of a default import, which the importer chooses. */
  defaultLocal?: string;
  dynamic: boolean;
}

/** The value imports (and re-exports) of a source file; type-only ones are left out. */
export function importsOf(text: string): ImportOf[] {
  const found: ImportOf[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const [, , isType, clause, spec] of text.matchAll(statement)) {
    if (isType) continue;
    const names: string[] = [];
    let defaultLocal: string | undefined;
    const braces = clause.match(/\{([^}]*)\}/);
    const outside = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (outside.startsWith("*")) names.push("*");
    else if (outside) {
      names.push("default");
      defaultLocal = outside;
    }
    for (const raw of (braces?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) continue;
      names.push(raw.split(/\s+as\s+/)[0]);
    }
    if (names.length > 0) found.push({ spec, names, defaultLocal, dynamic: false });
  }
  for (const [, spec] of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) found.push({ spec, names: [], dynamic: false });
  for (const [, spec] of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ spec, names: [], dynamic: true });
  return found;
}

/** A component's name: PascalCase with a lowercase letter, so not a constant (`HIGHLIGHT_SECTIONS`) or a function. */
export const looksLikeComponent = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);

export function boundary(files: Files) {
  const imports = new Map([...files].map(([f, text]) => [f, importsOf(text)]));
  const isClient = (f: string) => /^\s*["']use client["']/.test(files.get(f)!);
  const isServerActions = (f: string) => /^\s*["']use server["']/.test(files.get(f)!);
  const directlyServerOnly = (f: string) => imports.get(f)!.some((i) => SERVER_ONLY_PACKAGES.test(i.spec));

  function resolve(from: string, spec: string): string | null {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.join(path.dirname(from), spec) : null;
    if (!base) return null;
    return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((ext) => base + ext).find((f) => files.has(f)) ?? null;
  }

  /** Every file a file pulls in as a value (not past a "use server" file), with the chain that leads there. */
  function reachable(start: string): Map<string, string[]> {
    const chains = new Map<string, string[]>([[start, [start]]]);
    const queue = [start];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (file !== start && isServerActions(file)) continue;
      for (const imp of imports.get(file)!) {
        const next = resolve(file, imp.spec);
        if (next && !chains.has(next)) {
          chains.set(next, [...chains.get(file)!, next]);
          queue.push(next);
        }
      }
    }
    return chains;
  }

  /** Check 1: client files that pull server-only code into the browser bundle. */
  function clientBundleOffenders(): string[] {
    const offenders: string[] = [];
    for (const file of [...files.keys()].filter(isClient)) {
      for (const [reached, chain] of reachable(file)) {
        if (!isServerActions(reached) && directlyServerOnly(reached)) offenders.push(`${chain.join(" -> ")} (server-only)`);
      }
    }
    return offenders;
  }

  /** Check 2: server files that use anything but a component from a client file. */
  function serverImportOffenders(): string[] {
    const inClientBundle = new Set([...files.keys()].filter(isClient).flatMap((f) => [...reachable(f).keys()]));
    const offenders: string[] = [];
    for (const file of files.keys()) {
      if (isClient(file) || inClientBundle.has(file)) continue;
      for (const imp of imports.get(file)!) {
        const target = resolve(file, imp.spec);
        if (!target || !isClient(target) || imp.dynamic) continue;
        for (const name of imp.names) {
          if (name === "*") offenders.push(`${file} imports a namespace (*) from the client file ${target}`);
          else if (name === "default") {
            if (!imp.defaultLocal || !looksLikeComponent(imp.defaultLocal)) offenders.push(`${file} imports the default ${imp.defaultLocal ?? "export"} from the client file ${target}`);
          } else if (!looksLikeComponent(name)) offenders.push(`${file} imports ${name} from the client file ${target}`);
        }
      }
    }
    return offenders;
  }

  return { clientBundleOffenders, serverImportOffenders };
}
