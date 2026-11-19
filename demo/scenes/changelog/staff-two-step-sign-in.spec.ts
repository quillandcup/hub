import { createHmac } from "node:crypto";
import { sessionCookies } from "../../auth";
import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for the changelog entry "staff-two-step-sign-in": run on demand with `pnpm changelog:capture staff-two-step-sign-in`.
 * Sets two-step sign-in up for the demo admin (typing a real code, worked out from the key the page shows), signs in again to
 * reach the "Enter your sign-in code" screen, then turns it off so the demo admin is left as it was found.
 */

/** The 6-digit code an authenticator app shows for a base32 key (RFC 6238: SHA-1, 30 seconds). */
function totp(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}

test("staff set up two-step sign-in and enter a code @changelog", async ({ page, context, signInAs }, testInfo) => {
  test.setTimeout(180_000);
  await signInAs("admin");

  // Set it up on the Account tab of Settings.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible({ timeout: 90_000 });
  const secret = (await page.getByTestId("mfa-secret").textContent())?.trim() ?? "";
  await page.getByLabel(/6-digit code/).fill(totp(secret));
  // Hide Next's development badge and the app's environment badge: they are not part of the product.
  await page.addStyleTag({ content: "nextjs-portal, div.fixed.bottom-4.right-4 { display: none !important; }" });
  await page.getByLabel(/6-digit code/).scrollIntoViewIfNeeded();
  await shot(page, testInfo, "set-up", { checks: false });
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/Two-step sign-in is on/)).toBeVisible({ timeout: 60_000 });

  // A fresh sign-in has only passed the first step, so the admin pages send it to the code screen.
  await context.clearCookies();
  await context.addCookies(await sessionCookies("admin"));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Enter your sign-in code" })).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({ content: "nextjs-portal, div.fixed.bottom-4.right-4 { display: none !important; }" });
  await shot(page, testInfo, "enter-code", { checks: false });

  // Put the demo admin back as it was: pass the step, then remove the factor.
  await page.locator("#mfa-code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/admin/, { timeout: 60_000 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: /Remove|Turn off/ }).last().click();
  await expect(page.getByText(/Two-step sign-in is off/)).toBeVisible({ timeout: 60_000 });
});
