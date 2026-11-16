import { expect, shot, test } from "../../fixtures";

/** Screenshots for "See how many places are left on an event, and sign up from its page": the retreat has a capacity and a ticket offer in the demo seed. */
test("an event with limited places shows places left and Sign up @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/events");
  await expect(page.getByText(/places? left/i).first()).toBeVisible();
  await shot(page, testInfo, "events-list");
  await page.getByRole("link", { name: /Winter Writing Retreat/ }).first().click();
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  await shot(page, testInfo, "event-page");
});
