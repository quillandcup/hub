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
    // purity, immutability and exhaustive-deps are clean and stay errors (default).
    // set-state-in-effect still has ~47 sites (fetch-on-mount that sets a loading flag,
    // reading localStorage/matchMedia after hydration, resetting state when a prop changes).
    // See docs/TODO.md "Clean Up set-state-in-effect Warnings".
    "react-hooks/set-state-in-effect": "warn",
  },
}];

export default eslintConfig;
