import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classify, DELEGATES } from "@/scripts/api-route-inventory";
import { analyzeHandlers, PUBLIC_HANDLERS, stalePublicHandlers, type HandlerReport } from "@/scripts/api-route-handlers";

/**
 * Guard: every exported handler of every route file has its own credential step, and the step is used.
 *
 * tests/lib/api-route-auth.test.ts classifies a route file as a whole, so a guarded POST would cover an unguarded GET in the same
 * file. This reads each handler with the TypeScript parser (scripts/api-route-handlers.ts): the check must be in the handler or a
 * function of the same file it calls, its result must not be thrown away, `requireApiPermission`'s verdict must be read, and
 * the check must come before the first query. The first half of this file proves each rule fails on a bad route; the second runs
 * them over src/app. See docs/trust/THREAT_MODEL.md, A01.
 */

const FILE = "src/app/api/example/route.ts";
const problemsOf = (src: string, delegate?: string) => analyzeHandlers(FILE, src, delegate).flatMap((r) => r.problems);
const reportOf = (src: string, method: string): HandlerReport => analyzeHandlers(FILE, src).find((r) => r.method === method)!;

const IMPORTS = `import { requireApiPermission } from "@/lib/supabase/api-auth";\nimport { createRepos } from "@/lib/data/repos";\n`;

describe("handler analysis: the credential step belongs to the handler", () => {
  it("fails a GET that has none while the POST in the same file is guarded", () => {
    const src = `${IMPORTS}
      export async function GET(request) { return Response.json({ ok: true }); }
      export async function POST(request) {
        const auth = await requireApiPermission(request, "pages.edit");
        if (auth.forbidden) return Response.json({}, { status: 403 });
        return Response.json({});
      }`;
    expect(reportOf(src, "POST").problems).toEqual([]);
    expect(reportOf(src, "GET").problems).toEqual([expect.stringContaining(`${FILE}#GET has no recognised credential step`)]);
  });

  it("does not count a guard name that is only in a comment", () => {
    const src = `export async function GET() {\n  // requireApiPermission(request, "pages.edit") belongs here\n  return Response.json({});\n}`;
    expect(problemsOf(src)).toEqual([expect.stringContaining("no recognised credential step")]);
  });

  it("accepts a guard in a function of the same file that the handler calls, even two calls deep", () => {
    const src = `${IMPORTS}
      async function gate(request) {
        const auth = await requireApiPermission(request, "pages.edit");
        if (auth.forbidden) return null;
        return auth;
      }
      async function handle(request) { return gate(request); }
      export async function POST(request) { return handle(request); }`;
    expect(problemsOf(src)).toEqual([]);
    expect(reportOf(src, "POST").kinds).toEqual(["admin"]);
  });

  it("follows `export { handler as GET }` and `export const GET = wrap(...)`", () => {
    const list = `${IMPORTS}async function handler(request) {\n const auth = await requireApiPermission(request, "pages.edit");\n if (auth.forbidden) return null;\n return 1;\n}\nexport { handler as GET };`;
    expect(analyzeHandlers(FILE, list).map((r) => [r.method, r.kinds, r.problems])).toEqual([["GET", ["admin"], []]]);
    const wrapped = `${IMPORTS}export const GET = wrap(async (request) => {\n const auth = await requireApiPermission(request, "pages.edit");\n if (auth.forbidden) return null;\n return 1;\n});`;
    expect(problemsOf(wrapped)).toEqual([]);
    expect(problemsOf(`export const GET = wrap(async () => 1);`)).toEqual([expect.stringContaining("no recognised credential step")]);
  });

  it("refuses a handler re-exported from another module, which it cannot read", () => {
    expect(problemsOf(`export { GET } from "./elsewhere";`)).toEqual([expect.stringContaining("re-exported from")]);
  });

  it("takes the guard from the delegate module of a thin route", () => {
    const src = `import { handle } from "@/modules/x";\nexport async function POST(request) { return handle(request); }`;
    expect(problemsOf(src)).toEqual([expect.stringContaining("no recognised credential step")]);
    expect(problemsOf(src, `export function handle(r) { return verifySlackSignature(r); }`)).toEqual([]);
  });

  it("lets a route in PUBLIC_ROUTES have no step, which is decided per file", () => {
    const own = analyzeHandlers("src/app/api/health/route.ts", `export async function GET() { return Response.json({}); }`);
    expect(own.flatMap((r) => r.problems)).toEqual([]);
  });
});

describe("handler analysis: the check is used", () => {
  it("fails a check whose result is thrown away", () => {
    const src = `${IMPORTS}export async function POST(request) {\n await requireApiPermission(request, "pages.edit");\n return Response.json({});\n}`;
    expect(problemsOf(src)).toEqual(expect.arrayContaining([expect.stringContaining("result of requireApiPermission() is discarded")]));
    expect(problemsOf(src.replace("requireApiPermission(request", "getCurrentUser(request"))).toEqual([expect.stringContaining("getCurrentUser() is discarded")]);
  });

  it("accepts a bare requirePermission(), which redirects or throws by itself", () => {
    const src = `export async function GET() {\n await requirePermission("pages.edit");\n return Response.json({});\n}`;
    expect(problemsOf(src)).toEqual([]);
  });

  it("fails a requireApiPermission verdict that is never read", () => {
    const src = `${IMPORTS}export async function POST(request) {\n const auth = await requireApiPermission(request, "pages.edit");\n return Response.json({ n: 1 });\n}`;
    expect(problemsOf(src)).toEqual([expect.stringContaining("auth.forbidden is never checked")]);
  });

  it("fails a verdict that is not bound to a variable", () => {
    const src = `${IMPORTS}export async function POST(request) {\n const { supabase } = await requireApiPermission(request, "pages.edit");\n return Response.json({});\n}`;
    expect(problemsOf(src)).toEqual([expect.stringContaining("bind the result of requireApiPermission()")]);
  });

  it("fails taking the client out of the verdict before .forbidden is checked", () => {
    const src = `${IMPORTS}export async function POST(request) {
      const auth = await requireApiPermission(request, "pages.edit");
      const { supabase } = auth;
      if (auth.forbidden) return Response.json({}, { status: 403 });
      return Response.json({});
    }`;
    expect(problemsOf(src)).toEqual([expect.stringContaining("auth is used before auth.forbidden is checked")]);
  });

  it("accepts .forbidden alone (the guard sets it when there is no user) and the usual .forbidden then .user", () => {
    const only = `${IMPORTS}export async function POST(request) {
      const auth = await requireApiPermission(request, "pages.edit");
      if (auth.forbidden) return Response.json({}, { status: 403 });
      return Response.json({ id: auth.user!.id });
    }`;
    const both = only.replace("return Response.json({ id", `if (!auth.user) return Response.json({}, { status: 401 });\n return Response.json({ id`);
    expect(problemsOf(only)).toEqual([]);
    expect(problemsOf(both)).toEqual([]);
  });

  it("checks the function that holds the call, not only the handler", () => {
    const src = `${IMPORTS}
      async function gate(request) {
        const auth = await requireApiPermission(request, "pages.edit");
        return auth.supabase;
      }
      export async function POST(request) { return gate(request); }`;
    expect(problemsOf(src)).toEqual([expect.stringMatching(/POST \(via gate\): auth\.forbidden is never checked/)]);
  });
});

describe("handler analysis: the check comes first", () => {
  it("fails a query that runs before the staff or member check", () => {
    const src = `${IMPORTS}export async function GET(request, { supabase }) {
      const rows = await supabase.from("members").select("id");
      const auth = await requireApiPermission(request, "members.read");
      if (auth.forbidden) return Response.json({}, { status: 403 });
      return Response.json(rows);
    }`;
    expect(problemsOf(src)).toEqual([expect.stringContaining("from() runs before the credential check")]);
    expect(problemsOf(src.replace(`supabase.from("members")`, "createRepos(supabase).members.all()").replace("{ supabase }", "x"))).toEqual([
      expect.stringContaining("createRepos() runs before the credential check"),
    ]);
  });

  it("lets a client be built first, since the session check needs the cookie client", () => {
    const src = `export async function GET() {
      const supabase = await createClient();
      const user = await getCurrentUser();
      if (!user) return Response.json({}, { status: 401 });
      return Response.json(await createRepos(supabase).me.get(user.id));
    }`;
    expect(problemsOf(src)).toEqual([]);
  });
});

describe("api route handlers", () => {
  const rows = classify();
  const reports = new Map<string, HandlerReport[]>(
    rows.map((r) => {
      const delegate = DELEGATES[r.file];
      return [r.file, analyzeHandlers(r.file, readFileSync(r.file, "utf8"), delegate ? readFileSync(delegate, "utf8") : undefined)];
    }),
  );

  it("finds the handlers of every route file", () => {
    const handlers = [...reports.values()].flat();
    expect(handlers.length).toBeGreaterThan(150);
    for (const r of rows) expect(reports.get(r.file)!.map((h) => h.method).sort(), r.file).toEqual([...r.methods].sort());
  });

  it("every handler authenticates itself, uses the result and checks before it queries", () => {
    const problems = [...reports.values()].flatMap((hs) => hs.flatMap((h) => h.problems));
    expect(problems, "Fix each, or for a handler that is public on purpose add it to PUBLIC_HANDLERS (scripts/api-route-handlers.ts) with the reason").toEqual([]);
  });

  it("PUBLIC_HANDLERS has no stale entry, and each has a reason", () => {
    expect(stalePublicHandlers(reports), "Remove these from PUBLIC_HANDLERS (handler gone, or it now has a credential step)").toEqual([]);
    for (const [key, reason] of Object.entries(PUBLIC_HANDLERS)) expect(reason.length, key).toBeGreaterThan(30);
  });
});
