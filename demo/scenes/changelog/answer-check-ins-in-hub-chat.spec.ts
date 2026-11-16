import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "../../env";
import { expect, shot, test } from "../../fixtures";

/** Screenshot for "Answer your check-in and check-out in Hub Chat": Billie Bot's check-in message with its scale, feeling list and buttons drawn as controls (fictional demo community; the controls are not pressed). */
async function appDmId(): Promise<string> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from("chat_channels").select("id").eq("kind", "dm").like("slack_channel_id", "CDEMOA%").limit(1).maybeSingle();
  if (error || !data) throw new Error("no demo app direct message (run pnpm demo:seed)");
  return data.id as string;
}

test("a member sees her check-in as controls she can answer @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto(`/chat/${await appDmId()}`);
  await expect(page.getByText("Sprint Prickle").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" }).first()).toBeVisible();
  await shot(page, testInfo, "check-in-controls");
});
