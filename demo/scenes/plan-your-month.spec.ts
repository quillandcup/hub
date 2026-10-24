import { resetCommitments } from "../db";
import { expect, shot, test } from "../fixtures";

/** Plan your month: look at the weekly schedule, commit to a few regular times, and see them under Commitments. */
test("a member commits to regular prickle times", async ({ page, signInAs }, testInfo) => {
  await resetCommitments("member");
  await signInAs("member");

  await page.goto("/my-prickles/all");
  await expect(page.getByText("The full recurring weekly schedule")).toBeVisible();
  await shot(page, testInfo, "all-prickles");

  await page.getByRole("button", { name: /Make a commitment/ }).click();
  await expect(page.getByText("Nothing picked yet.")).toBeVisible();
  const boxes = page.getByRole("checkbox");
  await boxes.nth(1).check();
  await boxes.nth(3).check();
  await page.getByRole("combobox").filter({ hasText: /weeks?/ }).first().selectOption({ label: "4 weeks" });
  await expect(page.getByRole("button", { name: /Commit to these 2/ })).toBeVisible();
  await shot(page, testInfo, "pick-and-commit");

  await page.getByRole("button", { name: /Commit to these 2/ }).click();
  // The commitment is saved by a server action (the button relabels while it runs): leave only once it says saved.
  await expect(page.getByText("Commitment saved")).toBeVisible();
  await page.goto("/my-prickles/commitments");
  await expect(page.getByText("Active commitments", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("No active commitments yet")).toHaveCount(0);
  await shot(page, testInfo, "commitments");
});
