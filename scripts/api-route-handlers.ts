// Per-handler check of the credential step in a route file (src/app/**/route.ts).
//
// scripts/api-route-inventory.ts classifies a route file as a whole: one `requireApiPermission(` anywhere in it counts for every handler.
// This reads each exported HTTP handler on its own with the TypeScript parser and checks what the file-level regexes cannot:
//
//   1. Each handler has a recognised credential step (CREDENTIAL_KINDS) in its own body or in a function of the same file it calls,
//      or is listed in PUBLIC_HANDLERS with the reason. A `GET` next to a guarded `POST` no longer rides on the `POST`'s check.
//   2. A credential check whose result is thrown away checks nothing (`await requireApiPermission(...)` as a bare statement).
//      `requirePermission` is the exception: it redirects or throws itself.
//   3. `requireApiPermission` returns a verdict instead of throwing: its result must be bound to a variable and `.forbidden` read before
//      anything else but `.user` is taken from it (`auth.supabase` and the like). `.forbidden` alone is enough to refuse a caller with
//      no session, since the guard sets it when there is no user (src/lib/supabase/api-auth.ts); the usual extra `!auth.user` 401 only
//      picks the status code.
//   4. A staff or member check comes before the first query or repository in the same function.
//
// Static analysis, not a proof: it cannot tell that a branch returns, only that the check is there, first and read.
// The route's own test (tests/api/) covers the refusal. See docs/trust/THREAT_MODEL.md, A01.

import ts from "typescript";
import { CREDENTIAL_KINDS, PUBLIC_ROUTES, stripComments } from "./api-route-inventory";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Handlers with no credential step, though the file has one for another method. Key: `<file>#<METHOD>`. Shrink-only: each needs a
 * reason it is safe (a reason that is only "TODO" belongs in docs/TODO.md instead).
 */
export const PUBLIC_HANDLERS: Record<string, string> = {
  "src/app/api/webhooks/calendar/route.ts#GET":
    "Liveness probe for the webhook URL: answers a fixed message, reads no data and changes nothing (the POST verifies the channel token).",
  "src/app/api/webhooks/zoom/route.ts#GET":
    "Liveness probe for the webhook URL: answers a fixed message, reads no data and changes nothing (the POST verifies the signature).",
};

/** Guards that redirect or throw by themselves, so a discarded result is fine. */
const THROWING_GUARDS = new Set(["requirePermission"]);

/** Kinds whose check is a call that must come before the handler touches data (the others read the request first, on purpose). */
const ORDERED_KINDS = ["admin", "session"];

/**
 * A call that reads or writes data, or wraps a client in the repositories. Building a client (`createClient()`,
 * `createServiceRoleClient()`) is not on the list: the session check needs the cookie client first, and a client alone reads nothing.
 */
const DATA_ACCESS = /^(from|rpc|createRepos)$/;

export interface HandlerReport {
  method: string;
  /** Credential kinds found in the handler and the same-file functions it calls (and the delegate module, if the route has one). */
  kinds: string[];
  /** What is wrong with it, in words for the person who has to fix it. Empty when fine. */
  problems: string[];
}

type FnNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFn(n: ts.Node): n is FnNode {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function kindsOfCall(name: string): string[] {
  return Object.entries(CREDENTIAL_KINDS)
    .filter(([, re]) => re.test(`${name}(`))
    .map(([k]) => k);
}

function kindsOfText(text: string): string[] {
  const code = stripComments(text);
  return Object.entries(CREDENTIAL_KINDS)
    .filter(([, re]) => re.test(code))
    .map(([k]) => k);
}

/** The node's text without comments, so a guard name in a comment is not a guard. */
function codeOf(n: ts.Node): string {
  return stripComments(n.getText());
}

function skipWrappers(n: ts.Node): ts.Node {
  let cur = n;
  while (cur.parent && (ts.isAwaitExpression(cur.parent) || ts.isParenthesizedExpression(cur.parent) || ts.isAsExpression(cur.parent))) cur = cur.parent;
  return cur;
}

function enclosingFn(n: ts.Node): ts.Node {
  let cur: ts.Node | undefined = n.parent;
  while (cur && !isFn(cur)) cur = cur.parent;
  return cur ?? n.getSourceFile();
}

function callsIn(root: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

/** Checks 2, 3 and 4 for one function that contains guard calls. */
function checkFunction(fn: ts.Node, label: string): string[] {
  const problems: string[] = [];
  // A handler written as `export const GET = wrap(async () => ...)` is a call expression, not a function: all its calls count.
  const calls = isFn(fn) ? callsIn(fn).filter((c) => enclosingFn(c) === fn) : callsIn(fn);
  const guards = calls.filter((c) => {
    const name = calleeName(c);
    return name !== undefined && kindsOfCall(name).length > 0;
  });
  if (guards.length === 0) return problems;

  for (const call of guards) {
    const name = calleeName(call)!;
    const outer = skipWrappers(call);
    if (!THROWING_GUARDS.has(name) && outer.parent && ts.isExpressionStatement(outer.parent)) {
      problems.push(`${label}: the result of ${name}() is discarded, so it checks nothing (use it, or make the guard throw)`);
    }
    if (name === "requireApiPermission") problems.push(...checkVerdictUse(call, name, label));
  }

  const ordered = guards.filter((c) => kindsOfCall(calleeName(c)!).some((k) => ORDERED_KINDS.includes(k)));
  if (ordered.length > 0) {
    const firstGuard = Math.min(...ordered.map((c) => c.getStart()));
    const early = calls.find((c) => {
      const name = calleeName(c);
      return name !== undefined && DATA_ACCESS.test(name) && c.getStart() < firstGuard;
    });
    if (early) problems.push(`${label}: ${calleeName(early)}() runs before the credential check`);
  }
  return problems;
}

/** `const auth = await requireApiPermission(...)`: `auth.user` and `auth.forbidden` are read before anything else is taken from `auth`. */
function checkVerdictUse(call: ts.CallExpression, name: string, label: string): string[] {
  const outer = skipWrappers(call);
  const decl = outer.parent;
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) {
    return [`${label}: bind the result of ${name}() to a variable (\`const auth = await ${name}(...)\`) and check .forbidden`];
  }
  const v = decl.name.text;
  const scope = enclosingFn(call);
  const uses: { pos: number; prop?: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === v && n !== decl.name && n.getStart() > call.getEnd()) {
      const p = n.parent;
      uses.push({ pos: n.getStart(), prop: ts.isPropertyAccessExpression(p) && p.expression === n ? p.name.text : undefined });
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  uses.sort((a, b) => a.pos - b.pos);
  const firstForbidden = uses.find((u) => u.prop === "forbidden")?.pos;
  if (firstForbidden === undefined) return [`${label}: ${v}.forbidden is never checked after ${name}()`];
  const early = uses.find((u) => u.prop !== "forbidden" && u.prop !== "user" && u.pos < firstForbidden);
  return early ? [`${label}: ${v} is used before ${v}.forbidden is checked`] : [];
}

interface Collected {
  /** Top-level functions and const initialisers of the file by name. */
  locals: Map<string, ts.Node>;
  /** The exported HTTP handlers: the function, or the name the `export { }` list points at. */
  handlers: Map<string, ts.Node | string>;
}

function collect(sf: ts.SourceFile): Collected {
  const locals = new Map<string, ts.Node>();
  const handlers = new Map<string, ts.Node | string>();
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st) && st.name) {
      locals.set(st.name.text, st);
      if (exported && HTTP_METHODS.includes(st.name.text)) handlers.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        locals.set(d.name.text, d.initializer);
        if (exported && HTTP_METHODS.includes(d.name.text)) handlers.set(d.name.text, d.initializer);
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (!HTTP_METHODS.includes(el.name.text)) continue;
        handlers.set(el.name.text, st.moduleSpecifier ? `re-exported from ${st.moduleSpecifier.getText()}` : (el.propertyName ?? el.name).text);
      }
    }
  }
  return { locals, handlers };
}

/** The handler and the same-file functions it calls, transitively. */
function reachable(root: ts.Node, locals: Map<string, ts.Node>): { name: string; node: ts.Node }[] {
  const seen = new Map<string, ts.Node>();
  const queue: ts.Node[] = [root];
  while (queue.length) {
    const n = queue.pop()!;
    for (const c of callsIn(n)) {
      const callee = ts.isIdentifier(c.expression) ? c.expression.text : undefined;
      const local = callee ? locals.get(callee) : undefined;
      if (callee && local && !seen.has(callee)) {
        seen.set(callee, local);
        queue.push(local);
      }
    }
  }
  return [...seen].map(([name, node]) => ({ name, node }));
}

/**
 * One report per exported HTTP handler of a route file.
 * `delegateSource` is the module a thin route hands over to (DELEGATES): its text counts for the kinds, since the guard lives there.
 */
export function analyzeHandlers(file: string, source: string, delegateSource?: string): HandlerReport[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { locals, handlers } = collect(sf);
  const out: HandlerReport[] = [];
  for (const method of HTTP_METHODS) {
    const entry = handlers.get(method);
    if (entry === undefined) continue;
    const root = typeof entry === "string" ? locals.get(entry) : entry;
    if (!root) {
      out.push({ method, kinds: [], problems: [`${file} ${method}: ${typeof entry === "string" && entry.startsWith("re-exported") ? entry : "its definition was not found"}; analyse the real handler (DELEGATES) or define it in the file`] });
      continue;
    }
    const helpers = reachable(root, locals);
    const text = [codeOf(root), ...helpers.map((h) => codeOf(h.node)), delegateSource ? stripComments(delegateSource) : ""].join("\n");
    const kinds = kindsOfText(text);
    const problems: string[] = [];
    const key = `${file}#${method}`;
    if (kinds.length === 0 && !(file in PUBLIC_ROUTES) && !(key in PUBLIC_HANDLERS)) {
      problems.push(`${key} has no recognised credential step (CREDENTIAL_KINDS) in itself or the functions it calls here; add one, or list it in PUBLIC_HANDLERS with the reason`);
    }
    const fns = [root, ...helpers.map((h) => h.node)];
    for (const [i, fn] of fns.entries()) {
      const label = `${key}${i === 0 ? "" : ` (via ${helpers[i - 1].name})`}`;
      problems.push(...checkFunction(fn, label));
    }
    out.push({ method, kinds, problems });
  }
  return out;
}

/** Entries of PUBLIC_HANDLERS that no longer match a handler without a credential step. */
export function stalePublicHandlers(reports: Map<string, HandlerReport[]>): string[] {
  return Object.keys(PUBLIC_HANDLERS).filter((key) => {
    const [file, method] = key.split("#");
    const found = reports.get(file)?.find((r) => r.method === method);
    return !found || found.kinds.length > 0;
  });
}
