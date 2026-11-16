import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "../../env";
import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for "Direct messages in Hub Chat": the sidebar with its Channels, Group messages and Direct messages
 * headings, beside a 1:1 direct message and a group message (seeded in demo/chat-seed.ts, fictional people only).
 */
async function conversationId(kind: "dm" | "group_dm", slackIdLike: string): Promise<string> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from("chat_channels").select("id").eq("kind", kind).like("slack_channel_id", slackIdLike).limit(1).maybeSingle();
  if (error || !data) throw new Error(`no demo ${kind} (run pnpm demo:seed)`);
  return data.id as string;
}

test("a member reads a direct message and a group message next to her channels @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/chat/${await conversationId("dm", "CDEMOD%")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("the lighthouse bakery is a delight").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Channels" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Group messages" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Direct messages" }).first()).toBeVisible();
  await shot(page, testInfo, "direct-message");

  await page.goto(`/chat/${await conversationId("group_dm", "CDEMOG%")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("see you at 8").first()).toBeVisible();
  await shot(page, testInfo, "group-message");
});
