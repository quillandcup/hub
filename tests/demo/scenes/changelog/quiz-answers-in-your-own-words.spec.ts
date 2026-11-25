import { expect, shot, test } from "../../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_QUIZ_LESSON } from "../../courses-seed";
import { resetQuizAttempts } from "../../db";

// The page checks inject a style that hides the development badge; the app's own content security policy blocks it, so it is let through here.
test.use({ bypassCSP: true });

/**
 * Screenshots for the changelog entry "Quiz questions you answer in your own words": the short answer and file upload questions of the
 * demo quiz ("Check your draft plan", tests/demo/courses-seed.ts) filled in, and the result with "What you wrote and uploaded". Run on
 * demand with `pnpm changelog:capture quiz-answers-in-your-own-words`; tagged @changelog so the scheduled help-screenshots run leaves it out.
 *
 * The attempt, the lesson's completion and the uploaded file are taken back afterwards, so the shared demo is left as found.
 */
test.afterEach(async () => {
  await resetQuizAttempts("member");
});

test("a member answers a quiz in their own words @changelog", async ({ page, signInAs }, testInfo) => {
  await resetQuizAttempts("member");
  await signInAs("member");

  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: DEMO_QUIZ_LESSON.title }).first().click();
  await expect(page.getByRole("heading", { name: DEMO_QUIZ_LESSON.title, level: 1 })).toBeVisible();
  const quiz = page.getByRole("region", { name: "Quiz", exact: true });

  await quiz.getByLabel("A number you can hit on your worst day").check();
  await quiz.getByLabel("Writing in a regular slot").check();
  await quiz.getByLabel("Skipping ahead when the middle sags").check();
  await quiz.getByLabel("Your answer").fill("A cozy mystery set in a lighthouse.");
  await quiz.getByLabel("File for question 4").setInputFiles({ name: "planner-page.txt", mimeType: "text/plain", buffer: Buffer.from("Working title: The Lighthouse Letters\n") });
  await expect(quiz.getByText("planner-page.txt")).toBeVisible();
  // Tall enough for the whole quiz to be on the screen, so its picture is not cut at the edge of the scrolling area.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await shot(page, testInfo, "quiz-own-words-questions", { element: quiz });
  await page.setViewportSize({ width: 1280, height: 800 });

  await quiz.getByRole("button", { name: "Submit answers" }).click();
  const results = page.getByRole("region", { name: "Quiz results" });
  await expect(results.getByText(/You scored 100%/)).toBeVisible();
  await expect(results.getByRole("heading", { name: "What you wrote and uploaded" })).toBeVisible();
  await shot(page, testInfo, "quiz-own-words-result", { element: results });
});
