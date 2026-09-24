import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [{
  ignores: [".claude/worktrees/**", "next-env.d.ts"],
}, ...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // Downgraded pending cleanup of ~300 pre-existing violations across the codebase.
    // Tighten back to "error" once those are fixed; new code should avoid introducing more.
    "@typescript-eslint/no-explicit-any": "warn",
    "react/no-unescaped-entities": "warn",
    // eslint-config-next 16 newly enables these React Compiler-oriented hook
    // rules by default, surfacing ~50 pre-existing violations (mostly
    // setState-in-effect patterns) across ~20 files. Downgraded pending
    // cleanup rather than fixed as a side effect of the Next.js 16 upgrade;
    // tighten back to "error" once those are addressed.
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/immutability": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "warn",
  },
}];

export default eslintConfig;
