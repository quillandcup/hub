import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "sign-in-links-last-one-hour": run on demand with `pnpm changelog:capture sign-in-links-last-one-hour`. */
test("the sign-in page offers a code from the email @changelog", async ({ page }, testInfo) => {
  await page.goto("/login?mode=code");
  await expect(page.getByLabel(/code/i).first()).toBeVisible();
  // Next's development badge and the app's environment badge are not part of the product.
  await page.addStyleTag({ content: "nextjs-portal, div.fixed.bottom-4.right-4 { display: none !important; }" });
  await shot(page, testInfo, "sign-in-code", { checks: false });
});
