import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Host prickles and plan your hosting month": the host's Hosting tab. */
test("a host opens the Hosting tab @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("host");
  await page.goto("/my-prickles/hosting");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "My Prickles" })).toBeVisible();
  await shot(page, testInfo, "hosting");
});
