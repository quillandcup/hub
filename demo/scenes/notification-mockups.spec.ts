import { createClient } from "@supabase/supabase-js";
import { expect, shot, test } from "../fixtures";
import { loadDemoEnv } from "../env";
import { emailPage, pushPage, slackMobilePage, slackPage, type PushDevice } from "../mockups/frames";
import { sampleMessages } from "@/lib/notification-test";
import { NOTIFICATION_SETTINGS_PATH } from "@/lib/notifications/notify";
import { APP_URL } from "@/lib/config";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";
import { createRepos } from "@/lib/data/repos";

/**
 * What members receive when the Hub reaches out, on each channel: the Slack message, the email and the browser
 * push, for every notification kind, drawn from the real message code with the demo community's data
 * (demo/mockups/frames.tsx). The in-app channel is the bell and banner in the app itself, so the other scenes
 * already show it. These are not the app's pages, so the page checks are off.
 */
test("every notification kind, as members receive it", async ({ page }, testInfo) => {
  const env = loadDemoEnv();
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
  const theme = testInfo.project.use.colorScheme === "dark" ? "dark" : "light";
  const frame = () => page.locator("[data-frame]");
  const noChecks = { checks: false } as const;

  for (const kind of NOTIFICATION_KINDS) {
    // As a member receives them (not the admin test send's "[Test]" version), with the settings link a real send carries.
    const messages = (await sampleMessages(createRepos(supabase), kind.id, new Date(), { test: false })).map((m) => ({
      ...m,
      footerLinks: [{ label: "Notification settings", url: `${APP_URL}${NOTIFICATION_SETTINGS_PATH}` }],
    }));
    expect(messages.length, `${kind.id} has a sample message`).toBeGreaterThan(0);
    for (const [i, message] of messages.entries()) {
      const label = messages.length > 1 ? `${kind.id}-${i + 1}` : kind.id;

      await page.setContent(slackPage(message, theme));
      await expect(frame()).toBeVisible();
      await shot(page, testInfo, `slack-${label}`, { element: frame(), ...noChecks });

      await page.setContent(slackMobilePage(message, theme));
      await expect(frame()).toBeVisible();
      await shot(page, testInfo, `slack-phone-${label}`, { element: frame(), ...noChecks });

      await page.setContent(await emailPage(kind.id, message));
      await expect(frame()).toBeVisible();
      await shot(page, testInfo, `email-${label}`, { element: frame(), ...noChecks });

      for (const device of ["desktop", "android", "iphone"] as PushDevice[]) {
        await page.setContent(pushPage(message, kind.id, device, theme));
        await expect(frame()).toBeVisible();
        await shot(page, testInfo, `push-${device}-${label}`, { element: frame(), ...noChecks });
      }
    }
  }
});
