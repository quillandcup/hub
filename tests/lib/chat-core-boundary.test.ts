import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

/**
 * The boundary between chat core and Slack (docs/architecture/CHAT_MODULE.md): core files do not import the Slack adapter's files, the Slack
 * libraries (`src/lib/slack-*`) or `@slack/*`; they ask the transport port. Files that still do are listed, with a reason each, in
 * config/chat-core-baseline.json, which only shrinks: a violation that is not listed fails, and so does a listed file that has become clean.
 * Enforced twice, like the page block boundary: the lint rule (checked here against sample imports) and a read of the real files.
 */

const baseline = JSON.parse(readFileSync(path.join(ROOT, "config/chat-core-baseline.json"), "utf8")).files as Record<string, string>;

const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "config/eslint.mjs") });
const violations = async (filePath: string, source: string) =>
  (await eslint.lintText(source, { filePath: path.join(ROOT, filePath) }))[0].messages.filter((m) => m.ruleId === "no-restricted-imports");

describe("the lint rule", () => {
  it.each([
    ["src/lib/chat/render.ts", "@/lib/slack-connect"],
    ["src/lib/chat/render.ts", "@/lib/slack-capture"],
    ["src/lib/chat/render.ts", "@/lib/slack"],
    ["src/lib/chat/render.ts", "@/modules/chat/slack/post"],
    ["src/lib/chat/render.ts", "./slack-post"],
    ["src/lib/chat/render.ts", "@/modules/chat/slack/gap-fill"],
    ["src/lib/chat/render.ts", "@slack/web-api"],
    ["src/lib/chat/render.ts", "@/modules/chat/slack"],
    ["src/lib/chat/render.ts", "@/modules/chat/slack/post"],
    ["src/app/(member)/chat/actions.ts", "@/modules/chat/slack/edit"],
    ["src/app/api/webhooks/slack/route.ts", "@/modules/events/page-blocks"],
    ["src/components/chat/MessageItem.tsx", "@/lib/slack-emoji"],
    ["src/app/(member)/chat/some-actions.ts", "@/modules/chat/slack/react"],
    ["src/app/api/chat/files/x/route.ts", "@/lib/slack-bot-token"],
    ["src/lib/data/chat-new.ts", "@/lib/slack-client"],
  ])("fails %s importing %s", async (file, from) => {
    expect((await violations(file, `import { x } from "${from}";\nexport const y = x;\n`)).length, `${file} -> ${from}`).toBeGreaterThan(0);
  });

  it.each([
    ["src/lib/chat/render.ts", "@/lib/chat/transports"],
    ["src/lib/chat/render.ts", "@/lib/chat/transport"],
    ["src/lib/chat/render.ts", "@/lib/data/repos"],
    ["src/lib/chat/transports.ts", "@/modules/chat-transport"],
    ["src/modules/chat/slack/post.ts", "@/lib/slack-connect"],
    ["src/modules/chat/slack/post.ts", "@slack/web-api"],
    ["src/modules/chat/slack/gap-fill.ts", "@/lib/slack-messages"],
    ["src/modules/chat/slack/index.ts", "@/modules/chat/slack/post"],
    ["src/app/api/webhooks/slack/route.ts", "@/modules/chat/slack/webhook"],
    ["src/app/api/reconcile/slack-dms/route.ts", "@/modules/chat/slack/dms"],
    ["src/app/api/process/chat/route.ts", "@/modules/chat/slack/lesson-links"],
    ["src/lib/slack-connect.ts", "@/lib/slack-client"],
    ["src/app/(member)/settings/SettingsPage.tsx", "@/lib/slack-connect"],
  ])("lets %s import %s", async (file, from) => {
    expect(await violations(file, `import { x } from "${from}";\nexport const y = x;\n`)).toHaveLength(0);
  });

  it("lets a baseline file keep its Slack import, so the rule can be adopted before the last file is converted", async () => {
    const [file] = Object.keys(baseline);
    expect(await violations(file, `import { x } from "@/lib/slack-capture";\nexport const y = x;\n`)).toHaveLength(0);
  });
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? sourceFiles(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });

const importsOf = (file: string) => [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

/** Imports that bring Slack into a file: the adapter's files, the Slack libraries, the SDK, or the adapter's folder. */
const slackSpec = /^@\/lib\/slack(-|$)|^@\/lib\/chat\/(slack-|gap-fill$)|^@slack\/|^@\/modules\/chat\/|^\.\/(slack-|gap-fill$)/;

const coreFiles = [
  ...sourceFiles("src/lib/chat"),
  ...sourceFiles("src/components/chat"),
  ...sourceFiles("src/app/(member)/chat"),
  ...sourceFiles("src/app/api/chat"),
  ...sourceFiles("src/app/api/process/chat"),
  ...readdirSync(path.join(ROOT, "src/lib/data")).filter((n) => /^chat.*\.ts$/.test(n)).map((n) => `src/lib/data/${n}`),
].filter((f) => !/^src\/lib\/chat\/(slack-[^/]*\.ts|gap-fill\.ts)$/.test(f));

describe("chat core's imports", () => {
  it("finds core", () => {
    expect(coreFiles.length).toBeGreaterThan(100);
  });

  it("reach Slack only from the files in the baseline", () => {
    const found = coreFiles.filter((f) => !(f in baseline)).flatMap((file) => importsOf(file).filter((spec) => slackSpec.test(spec)).map((spec) => `${file} imports ${spec}`));
    expect(found).toEqual([]);
  });

  it("go through the port: the transport registry is the only core file that names the composition root", () => {
    const found = coreFiles.filter((f) => importsOf(f).some((spec) => spec === "@/modules/chat-transport"));
    expect(found).toEqual(["src/lib/chat/transports.ts"]);
  });
});

describe("the baseline", () => {
  it("lists only files that exist and still import Slack (it shrinks, never holds a stale entry)", () => {
    const stale = Object.keys(baseline).filter((f) => !existsSync(path.join(ROOT, f)) || !importsOf(f).some((spec) => slackSpec.test(spec)));
    expect(stale).toEqual([]);
  });

  it("gives a reason for every entry", () => {
    const missing = Object.entries(baseline).filter(([, reason]) => reason.trim().length < 20).map(([f]) => f);
    expect(missing).toEqual([]);
  });
});
