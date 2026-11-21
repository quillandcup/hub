import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "../../env";
import { expect, shot, test } from "../../fixtures";

/** Screenshots for "Jump to any day in a chat conversation": the Jump to... menu opened from a day label (fictional people only). */
async function dmId(): Promise<string> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from("chat_channels").select("id").eq("kind", "dm").like("slack_channel_id", "CDEMOD%").limit(1).maybeSingle();
  if (error || !data) throw new Error("no demo direct message (run pnpm demo:seed)");
  return data.id as string;
}

test("a member opens the day label and sees where she can jump @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto(`/chat/${await dmId()}`);
  const label = page.getByRole("button", { name: /jump to another day$/ }).first();
  await expect(label).toBeVisible();
  await label.click();
  await expect(page.getByText("Jump to a specific date")).toBeVisible();
  await shot(page, testInfo, "jump-to-menu");
});
