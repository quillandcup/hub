#!/usr/bin/env tsx

/**
 * Downloads Kajabi's "Product Progress" export (course completion/engagement
 * data). Kajabi has no API for this data -- it's only available as a manual
 * Excel export from Analytics -> Product Progress.
 *
 * Kajabi's admin account has 2FA enabled, so this script cannot log in with
 * a plain email/password flow. Instead it reuses a saved browser session
 * (Playwright storageState) captured by hand once. See
 * docs/KAJABI_PRODUCT_PROGRESS_SYNC.md for how to capture/refresh that
 * session -- this is the one manual step this automation can't remove.
 *
 * NOTE: the exact navigation URL and export-button selector below are best
 * guesses based on Kajabi's admin URL conventions used elsewhere in this
 * repo (docs/KAJABI_DATA_MODEL.md, docs/KAJABI_SCRAPER_DESIGN.md) -- they
 * have not been verified against a live Kajabi account. The first real run
 * will likely need a selector fix; run headed locally (HEADLESS=false) to
 * diagnose.
 */

import { config } from "dotenv";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import path from "path";

config({ path: ".env.local" });

const SESSION_STATE_PATH = process.env.KAJABI_SESSION_STATE_PATH || "kajabi-session.json";
const OUTPUT_DIR = process.env.KAJABI_EXPORT_DIR || "downloads";
const OUTPUT_PATH = path.join(OUTPUT_DIR, "kajabi-product-progress.xlsx");
const HEADLESS = process.env.HEADLESS !== "false";

const SESSION_EXPIRED_MESSAGE =
  "Kajabi session expired (redirected to login). Refresh KAJABI_SESSION_STATE -- see docs/KAJABI_PRODUCT_PROGRESS_SYNC.md.";

async function main() {
  if (!existsSync(SESSION_STATE_PATH)) {
    console.error(
      `Error: session state file not found at ${SESSION_STATE_PATH}. ` +
        `See docs/KAJABI_PRODUCT_PROGRESS_SYNC.md to capture one.`
    );
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ storageState: SESSION_STATE_PATH });
  const page = await context.newPage();

  try {
    console.log("Navigating to Kajabi Product Progress analytics...");
    await page.goto("https://app.kajabi.com/admin/analytics/product-progress", {
      waitUntil: "domcontentloaded",
    });

    if (page.url().includes("/login") || page.url().includes("/sign_in")) {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }

    console.log("Triggering export...");
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /export/i }).click();
    const download = await downloadPromise;

    await download.saveAs(OUTPUT_PATH);
    console.log(`Saved export to ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
