import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "../../env";
import { expect, shot, test } from "../../fixtures";

/** Screenshots for "Mark a message unread in Hub Chat": the More actions menu on a message, with Mark unread in it (fictional people only). */
async function dmId(): Promise<string> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from("chat_channels").select("id").eq("kind", "dm").like("slack_channel_id", "CDEMOD%").limit(1).maybeSingle();
  if (error || !data) throw new Error("no demo direct message (run pnpm demo:seed)");
  return data.id as string;
}

test("a member opens the menu on a message and finds Mark unread @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto(`/chat/${await dmId()}`);
  const message = page.getByText("the lighthouse bakery is a delight").first();
  await expect(message).toBeVisible();
  await message.hover();
  await page.getByRole("button", { name: "More actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Mark unread" })).toBeVisible();
  await shot(page, testInfo, "mark-unread-menu");
});
