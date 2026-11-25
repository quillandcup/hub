import { expect, shot, test } from "../../fixtures";
import { demoQuizIds } from "../../db";

/**
 * Screenshots for the changelog entry "Build quizzes in the course builder": the Questions page of the demo quiz ("Check your draft
 * plan", tests/demo/courses-seed.ts) with a graded choice question, a short answer and a file upload; the Results page; and one
 * member's answers. Run on demand with `pnpm changelog:capture quiz-builder`; tagged @changelog so the scheduled help-screenshots run
 * leaves it out. The scene only reads: it changes nothing in the demo.
 */
test("staff read a quiz's questions and results @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("admin");
  const { courseId, lessonId } = await demoQuizIds();
  const base = `/admin/courses/${courseId}/lessons/${lessonId}`;

  await page.goto(`${base}/questions`);
  await expect(page.getByRole("link", { name: "Results", exact: true })).toBeVisible();
  await expect(page.getByText("In a sentence, which story will you finish?").first()).toBeVisible();
  await shot(page, testInfo, "quiz-questions", { fullPage: true });

  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(page.getByRole("link", { name: /View answers/ }).first()).toBeVisible();
  await shot(page, testInfo, "quiz-results", { fullPage: true });

  await page.getByRole("link", { name: /View answers/ }).first().click();
  await expect(page.getByText("A cozy mystery set in a lighthouse.")).toBeVisible();
  await expect(page.getByRole("link", { name: "draft-plan.txt" })).toBeVisible();
  await shot(page, testInfo, "quiz-member-answers", { fullPage: true });
});
