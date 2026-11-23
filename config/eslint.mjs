import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { readFileSync } from "node:fs";

// Modules (src/modules/<name>/) contribute to the host through the composition root, which is the only thing outside a module that names
// one: src/modules/index.ts, editor.ts, server.ts and chat-transport.ts (docs/architecture/PAGE_BLOCKS.md). "!" re-allows those three.
const MODULE_ROOTS = ["!@/modules/index", "!@/modules/editor", "!@/modules/server", "!@/modules/chat-transport"];
const MODULE_INTERNALS = {
  group: ["@/modules/**", ...MODULE_ROOTS],
  message: "Import a module's code only from the composition root (src/modules/index.ts, editor.ts, server.ts); everything else imports the root or the host's registry.",
};
// What the page builder (the pages code: src/lib/landing and src/components/landing) must not know about: the events code. A block about events
// is the events module's, contributed to the page block registry (docs/architecture/PAGE_BLOCKS.md).
const EVENTS_CODE = {
  group: ["@/lib/events-*", "@/lib/event-*", "@/lib/events/**", "@/lib/calendar-*", "@/lib/data/events", "@/components/EventArt", "@/app/**/events/**"],
  message: "The pages code does not import events code. A block about events belongs to the events module (src/modules/events/page-blocks), which contributes it to the page block registry.",
};

// Chat core must not know Slack (docs/architecture/CHAT_MODULE.md): not the Slack adapter's files, not the Slack libraries (src/lib/slack-*),
// not @slack/*. Files that still do are listed, each with its reason, in config/chat-core-baseline.json (shrink-only, checked by
// tests/lib/chat-core-boundary.test.ts); they are left out of this rule until their last Slack import is gone.
const CHAT_SLACK_CODE = {
  group: ["slack", "slack-*", "gap-fill", "@slack/**", "@/modules/chat/**"],
  message: "Chat core does not import Slack. Ask the transport port instead (src/lib/chat/transport.ts, via chatTransport() from src/lib/chat/transports.ts); Slack code belongs to the adapter (src/modules/chat/slack).",
};
const CHAT_CORE_FILES = ["src/lib/chat/**/*.{ts,tsx}", "src/components/chat/**/*.{ts,tsx}", "src/app/(member)/chat/**/*.{ts,tsx}", "src/app/api/chat/**/*.{ts,tsx}", "src/app/api/process/chat/**/*.{ts,tsx}", "src/lib/data/chat*.ts"];
// Slack-side files that still sit outside src/modules/chat/slack (the webhook, the reconcile and import routes, the check-in DM close) and use the
// adapter's helpers; the baseline files below reach for them too until they move (docs/architecture/CHAT_MODULE.md).
const CHAT_SLACK_SIDE_FILES = ["src/lib/prickle-checkin-dm-close.ts", "src/app/api/reconcile/slack-dms/**/*.ts", "src/app/api/webhooks/slack/**/*.ts", "src/app/api/import/slack-api/**/*.ts"];
const CHAT_BASELINE = Object.keys(JSON.parse(readFileSync(new URL("./chat-core-baseline.json", import.meta.url), "utf8")).files).map((f) => f.replace(/[\\[\]]/g, "\\$&"));

const eslintConfig = [{
  ignores: [".claude/worktrees/**", "next-env.d.ts", ".next-demo/**", "tests/demo/.stack/**", "tests/demo/out/**"],
}, ...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // Downgraded pending cleanup of ~300 pre-existing violations across the codebase.
    // Tighten back to "error" once those are fixed; new code should avoid introducing more.
    "@typescript-eslint/no-explicit-any": "warn",
    "react/no-unescaped-entities": "warn",
    // purity, immutability and exhaustive-deps are clean and stay errors (default).
    // set-state-in-effect still has ~47 sites (fetch-on-mount that sets a loading flag,
    // reading localStorage/matchMedia after hydration, resetting state when a prop changes).
    // See docs/TODO.md "Clean Up set-state-in-effect Warnings".
    "react-hooks/set-state-in-effect": "warn",
  },
}, {
  // The app names a module only through the composition root.
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/modules/**", "src/lib/landing/**", "src/components/landing/**"],
  rules: { "no-restricted-imports": ["error", { patterns: [MODULE_INTERNALS] }] },
}, {
  // The pages code: the same, and no events code either (a rule per file set, since a second config object would replace this one).
  files: ["src/lib/landing/**/*.{ts,tsx}", "src/components/landing/**/*.{ts,tsx}"],
  rules: { "no-restricted-imports": ["error", { patterns: [MODULE_INTERNALS, EVENTS_CODE] }] },
}, {
  // The Slack-side files still outside the adapter's folder may import its helpers (but still not another module's internals).
  files: [...CHAT_SLACK_SIDE_FILES, ...CHAT_BASELINE],
  rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@/modules/events/**"], message: MODULE_INTERNALS.message }] }] },
}, {
  // Chat core: no Slack. A rule per file set again, so the module rule is repeated.
  files: CHAT_CORE_FILES,
  ignores: [...CHAT_BASELINE],
  rules: { "no-restricted-imports": ["error", { patterns: [MODULE_INTERNALS, CHAT_SLACK_CODE] }] },
}];

export default eslintConfig;
