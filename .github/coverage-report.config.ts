// Read as text by davelosert/vitest-coverage-report-action (vite-config-path in ci.yml),
// which regex-extracts coverage thresholds from the config it is given. vitest.config.mts has
// per-glob lib/** floors that the action would show as the whole codebase's targets, so it
// reads this threshold-free stub instead. Nothing imports it; the floors that gate the build
// stay in vitest.config.mts.
export default {
  test: {
    coverage: {},
  },
};
