import { expect, shot, test } from "../../fixtures";
import { persona } from "../../personas";

/**
 * Screenshot for the changelog entry "Sign in with a code from your email": the real sign-in email the demo stack sends, as
 * the stack's mail catcher (Mailpit) received it. The member asks for a link on /login; Supabase Auth sends the email with
 * its template (supabase/templates), so the code in the picture is the one it generated (the demo community is fictional).
 */
test("a member asks for a sign-in link and the email has a code @changelog", async ({ page, request }, testInfo) => {
  const mail = process.env.DEMO_MAIL_URL ?? "http://127.0.0.1:56324";
  const email = persona("member").email;
  await request.delete(`${mail}/api/v1/messages`);

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send Magic Link" }).click();
  await expect(page.getByText(/check your email|sent/i).first()).toBeVisible();

  let id = "";
  await expect
    .poll(async () => {
      const list = (await (await request.get(`${mail}/api/v1/messages`)).json()) as { messages: { ID: string; To: { Address: string }[] }[] };
      id = list.messages.find((m) => m.To.some((t) => t.Address === email))?.ID ?? "";
      return id;
    })
    .not.toBe("");

  // The email's own HTML, as Mailpit serves it, on a plain page the width of an email.
  // Cropped above the plain-text fallback link, which holds the demo stack's local address and a one-time token.
  await page.setViewportSize({ width: 720, height: 650 });
  await page.goto(`${mail}/view/${id}.html`);
  await shot(page, testInfo, "sign-in-email", { checks: false });
});
