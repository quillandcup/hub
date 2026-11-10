import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { boundary, importsOf, looksLikeComponent, serverActionExportOffenders, type Files } from "../helpers/client-server-boundary";

/**
 * The client/server import boundary (see tests/helpers/client-server-boundary.ts for the rules). A build and the
 * component tests, which run in Node where every import just works, don't notice a break; the person gets "a
 * client-side exception". This is how the past events page broke (#587, #589).
 */

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "lib", "emails"];

function sources(dir: string): string[] {
  if (!fs.existsSync(path.join(ROOT, dir))) return [];
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

const real: Files = new Map(DIRS.flatMap(sources).map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
const fixture = (files: Record<string, string>): Files => new Map(Object.entries(files));

describe("the client/server import boundary, in the app", () => {
  it("exports only async functions from every use server module", () => {
    expect([...real.values()].filter((text) => text.includes("use server")).length).toBeGreaterThan(40);
    expect(serverActionExportOffenders(real)).toEqual([]);
  });
  it("keeps server-only code out of every client bundle", () => {
    expect(boundary(real).clientBundleOffenders()).toEqual([]);
  });

  it("imports only components from a client file into a server file", () => {
    expect(boundary(real).serverImportOffenders()).toEqual([]);
  });
});

describe("server action exports, on examples", () => {
  it("rejects the chat regression and other runtime values, including multiline exports", () => {
    const offenders = serverActionExportOffenders(fixture({
      "app/actions.ts": `// Header comment
"use server";
export const NOTIFY_SETTINGS = ["default", "all"] as const;
export const config = {};
export function sync() { return 1; }
export class Settings {}
export enum Setting { All }
const hidden = [];
export {
  hidden as settings
};
export default {};
`,
    }));
    expect(offenders).toHaveLength(7);
    expect(offenders[0]).toContain("app/actions.ts:3 exports NOTIFY_SETTINGS");
    expect(offenders.some((message) => message.includes("exports settings"))).toBe(true);
  });

  it("allows async declarations, async expressions, aliases and type-only exports", () => {
    expect(serverActionExportOffenders(fixture({
      "lib/actions.ts": `/* Header */
'use strict';
'use server';
export async function save() {}
export const remove = async () => {};
export const update = async function () {};
async function local() {}
export { local as renamed };
export default async function () {}
export interface Result { ok: boolean }
export type Choice = "all";
export type { Something } from "./types";
export { type Another } from "./types";
`,
      "components/Widget.tsx": '"use client"; export const values = [];',
      "lib/shared.ts": 'export const values = [];',
      "app/inline.ts": 'export function render() { async function save() { "use server"; } }',
    }))).toEqual([]);
  });

  it("requires explicit async entry points instead of unchecked runtime re-exports", () => {
    expect(serverActionExportOffenders(fixture({
      "app/actions.ts": '"use server"; export * from "./shared"; export { values } from "./shared";',
    }))).toHaveLength(2);
  });
});

describe("the client/server import boundary, on examples", () => {
  const CLIENT = '"use client";\nexport function Widget() { return null }\nexport function helper() { return 1 }\nexport const LIMITS = [1];\nexport default function Panel() { return null }\n';

  it("flags a client file that reaches server-only code, however far down, but not through a server action", () => {
    const direct = fixture({
      "app/a/Client.tsx": '"use client";\nimport { thing } from "@/lib/mid";',
      "lib/mid.ts": 'import { other } from "./deep";',
      "lib/deep.ts": 'import { cookies } from "next/headers";',
    });
    expect(boundary(direct).clientBundleOffenders()).toEqual(["app/a/Client.tsx -> lib/mid.ts -> lib/deep.ts (server-only)"]);

    const viaAction = fixture({
      "app/a/Client.tsx": '"use client";\nimport { save } from "./actions";',
      "app/a/actions.ts": '"use server";\nimport { cookies } from "next/headers";',
    });
    expect(boundary(viaAction).clientBundleOffenders()).toEqual([]);
  });

  it("flags a client file that reaches a server SDK, as #615 did through the Slack alert path", () => {
    const files = fixture({
      "components/History.tsx": '"use client";\nimport { feed } from "@/lib/feed";',
      "lib/feed.ts": 'import { throwIfDbError } from "@/lib/trace";',
      "lib/trace.ts": 'import { sendAlert } from "@/lib/alerts";',
      "lib/alerts.ts": 'import { WebClient } from "@slack/web-api";',
    });
    expect(boundary(files).clientBundleOffenders()).toEqual([
      "components/History.tsx -> lib/feed.ts -> lib/trace.ts -> lib/alerts.ts (server-only)",
    ]);
  });

  it("ignores a type import, and what the browser can load", () => {
    const files = fixture({
      "app/a/Client.tsx": '"use client";\nimport type { Db } from "@/lib/server";\nimport { randomInt } from "crypto";',
      "lib/server.ts": 'import { cookies } from "next/headers";',
    });
    expect(boundary(files).clientBundleOffenders()).toEqual([]);
  });

  it("flags a server file that calls a function, reads a constant, or takes a namespace or lowercase default from a client file", () => {
    const files = fixture({
      "app/a/Client.tsx": CLIENT,
      "app/a/page.tsx": 'import { helper, LIMITS, Widget } from "./Client";\nimport Panel from "./Client";\nimport * as client from "./Client";\nimport render from "./Client";\nexport { helper as again } from "./Client";',
    });
    expect(boundary(files).serverImportOffenders()).toEqual([
      "app/a/page.tsx imports helper from the client file app/a/Client.tsx",
      "app/a/page.tsx imports LIMITS from the client file app/a/Client.tsx",
      "app/a/page.tsx imports a namespace (*) from the client file app/a/Client.tsx",
      "app/a/page.tsx imports the default render from the client file app/a/Client.tsx",
      "app/a/page.tsx imports helper from the client file app/a/Client.tsx",
    ]);
  });

  it("lets a server file render a client component, import its types, and load it dynamically", () => {
    const files = fixture({
      "app/a/Client.tsx": CLIENT,
      "app/a/page.tsx": 'import Panel, { Widget, type Props } from "./Client";\nimport type { helper } from "./Client";\nconst Lazy = import("./Client");',
    });
    expect(boundary(files).serverImportOffenders()).toEqual([]);
  });

  it("does not hold a file the client bundles to the server rule: it is client code without the directive", () => {
    const files = fixture({
      "app/a/Client.tsx": CLIENT,
      "lib/shared.ts": 'import { helper } from "@/app/a/Client";',
      "app/b/Other.tsx": '"use client";\nimport { x } from "@/lib/shared";',
    });
    expect(boundary(files).serverImportOffenders()).toEqual([]);
  });
});

describe("reading imports", () => {
  it("reads the import forms it has to judge", () => {
    const text = [
      'import Default, { a, type T, b as c } from "x";',
      'import type { OnlyType } from "y";',
      'import { type A, type B } from "z";',
      'import * as ns from "n";',
      'export { e, type F } from "re";',
      'export * from "all";',
      'export type { G } from "g";',
      'import "side";',
      'const lazy = import("dyn");',
      "import {\n  m1,\n  m2,\n} from \"multi\";",
    ].join("\n");
    expect(importsOf(text)).toEqual([
      { spec: "x", names: ["default", "a", "b"], defaultLocal: "Default", dynamic: false },
      { spec: "n", names: ["*"], defaultLocal: undefined, dynamic: false },
      { spec: "re", names: ["e"], defaultLocal: undefined, dynamic: false },
      { spec: "all", names: ["*"], defaultLocal: undefined, dynamic: false },
      { spec: "multi", names: ["m1", "m2"], defaultLocal: undefined, dynamic: false },
      { spec: "side", names: [], dynamic: false },
      { spec: "dyn", names: [], dynamic: true },
    ]);
  });

  it("tells a component from a function or a constant", () => {
    for (const component of ["PillFilter", "AgendaWeeks", "A1b"]) expect(looksLikeComponent(component)).toBe(true);
    for (const other of ["eventDays", "HIGHLIGHT_SECTIONS", "URL", "useThing", "withoutFollowedEvents"]) expect(looksLikeComponent(other)).toBe(false);
  });
});
