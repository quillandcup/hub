import { defineConfig } from "playwright/test";

/** The overview videos (demo/video/overview.spec.ts). One browser, one scene at a time; the director sets the size. */
export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.ts"],
  outputDir: "../out/.playwright-video",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "off" },
});
