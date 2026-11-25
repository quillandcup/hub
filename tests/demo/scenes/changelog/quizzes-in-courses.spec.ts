import { expect, shot, test } from "../../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_QUIZ_LESSON } from "../../courses-seed";
import { resetQuizAttempts } from "../../db";

/**
 * Screenshots for the changelog entries "Quizzes in your courses" and "Quiz questions you answer in your own words": a member
 * opens the demo quiz ("Check your draft plan", tests/demo/courses-seed.ts), answers every kind of question, submits, and reads
 * the result with the right answers and what she wrote. Run on demand with `pnpm changelog:capture quizzes-in-courses`; tagged
 * @changelog so the scheduled help-screenshots run leaves it out.
 *
 * The attempt, the lesson's completion and the uploaded file are taken back afterwards, so the shared demo is left as found.
 */
test.afterEach(async () => {
  await resetQuizAttempts("member");
});

test("a member takes a quiz and reads the result @changelog", async ({ page, signInAs }, testInfo) => {
  await resetQuizAttempts("member");
  await signInAs("member");

  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: DEMO_QUIZ_LESSON.title }).first().click();
  await expect(page.getByRole("heading", { name: DEMO_QUIZ_LESSON.title, level: 1 })).toBeVisible();
  const quiz = page.getByRole("region", { name: "Quiz", exact: true });
  await expect(quiz.getByRole("form", { name: "Quiz questions" })).toBeVisible();

  // One right answer, one half right, a short answer and a small file.
  await quiz.getByLabel("A number you can hit on your worst day").check();
  await quiz.getByLabel("Writing in a regular slot").check();
  await quiz.getByLabel("Your answer").fill("A cozy mystery set in a lighthouse.");
  await quiz.getByLabel("File for question 4").setInputFiles({ name: "planner-page.txt", mimeType: "text/plain", buffer: Buffer.from("Working title: The Lighthouse Letters\n") });
  await expect(quiz.getByText("planner-page.txt")).toBeVisible();
  await expect(quiz.getByText("4 of 4 answered")).toBeVisible();
  await shot(page, testInfo, "quiz-questions", { fullPage: true });

  await quiz.getByRole("button", { name: "Submit answers" }).click();
  await expect(page.getByRole("region", { name: "Quiz results" }).getByText(/You scored 50%/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What you wrote and uploaded" })).toBeVisible();
  await shot(page, testInfo, "quiz-result", { fullPage: true });
});
