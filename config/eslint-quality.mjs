// Report-only code-quality rules, kept apart from config/eslint.mjs so `pnpm lint` is unchanged
// (the main config gates CI; these are all warnings and nothing reads them as a gate yet).
// Run with `pnpm lint:quality`; scripts/quality-new-code.ts narrows the result to added lines.
import nextTypescript from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";

// Only the TypeScript parser from the Next config (typescript-eslint is not a direct dependency):
// none of its rules are switched on here, so the report holds just the quality findings.
const parserConfig = nextTypescript.find((c) => c.languageOptions?.parser);

export default [
  {
    ignores: [
      ".claude/worktrees/**",
      ".next/**",
      ".next-demo/**",
      "demo/.stack/**",
      "demo/out/**",
      "next-env.d.ts",
      "coverage/**",
      "reports/**",
      "supabase/migrations/**",
      "lib/data/database.types.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    languageOptions: parserConfig?.languageOptions,
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { sonarjs },
    rules: {
      complexity: ["warn", 15],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5],
      "max-nested-callbacks": ["warn", 4],
      "sonarjs/cognitive-complexity": ["warn", 15],
      "sonarjs/no-duplicated-branches": "warn",
      "sonarjs/no-identical-functions": "warn",
      "sonarjs/no-all-duplicated-branches": "warn",
      "sonarjs/no-identical-conditions": "warn",
    },
  },
];
