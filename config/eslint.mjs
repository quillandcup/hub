import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Modules (src/modules/<name>/) contribute to the host through the composition root, which is the only thing outside a module that names
// one: src/modules/index.ts, editor.ts and server.ts (docs/architecture/PAGE_BLOCKS.md). "!" re-allows those three.
const MODULE_ROOTS = ["!@/modules/index", "!@/modules/editor", "!@/modules/server"];
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
}];

export default eslintConfig;
