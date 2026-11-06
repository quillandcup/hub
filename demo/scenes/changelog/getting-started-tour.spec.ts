import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "A Getting started tour for new members". Run with `pnpm changelog:capture getting-started-tour`. */
test("a newcomer opens the Getting started checklist @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("newcomer");
  await page.goto("/dashboard");
  const card = page.getByRole("region", { name: "Getting started" });
  const toggle = card.getByRole("button", { name: /Getting started/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await shot(page, testInfo, "getting-started");
});
